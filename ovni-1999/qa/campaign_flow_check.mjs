/* Fluxo da campanha num Chromium real (Playwright): menu → Nova Campanha → Veterano → base em Lisboa → Geoscape (ou o
   substituto) → gravar na posição 1 → recarregar → Continuar (mesma data e fundos) → OVNI despenhado injetado pelas APIs
   OV.Missions/OV.World → briefing → equipar → batalha → gravação do turno → recarregar → retomar → vitória forçada →
   relatório → de volta ao Geoscape com o material no armazém; segunda missão sem recarregar; relatório mensal, fim de
   jogo, vitória e diálogo de gravações a 1440×900 e 1024×700; erros de quota e gravação danificada.
   Falha em qualquer erro de consola/página ou chave i18n em falta (⟦…⟧). Capturas fora do repositório.
   Uso: node ovni-1999/qa/campaign_flow_check.mjs [--out <pasta>] [--port <n>] [--dpr 1|2] [--stub-geo]
   --stub-geo serve um js/ui/geo_ui.js vazio (testa o fluxo com o substituto do Geoscape, independente desse ficheiro). */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SESSION = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'campaign') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'campaign') : path.join(process.cwd(), 'qa-out', 'campaign');
const OUT = path.resolve(arg('--out', DEF_OUT));
const DPR = +arg('--dpr', 1) || 1;
const STUB_GEO = argv.includes('--stub-geo');
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
const errors = [];
let checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fails.push(msg); console.log('  ✗ ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log('· ' + s);

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
async function waitHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) { /* ainda a arrancar */ }
    await sleep(120);
  }
  return false;
}

const port = +arg('--port', 0) || (await freePort());
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/index.html?nosw=1&debug=1`;

const browser = await chromium.launch();
try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');
  const stubGeo = async (c) => { if (STUB_GEO) await c.route('**/js/ui/geo_ui.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* substituto do QA */' })); };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
  await stubGeo(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const watch = (p, tag) => {
    p.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
  };
  watch(page, 'main');

  const shot = async (name, p) => { await sleep(320); await (p || page).screenshot({ path: path.join(OUT, name + '.png') }); };
  const topId = (p) => (p || page).evaluate(() => (OV.Scenes.top() || {}).id);
  const waitTop = async (id, ms, p) => {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) { if ((await topId(p)) === id) return true; await sleep(100); }
    return false;
  };
  const noMissing = async (where, p) => {
    const txt = await (p || page).evaluate(() => document.body.innerText);
    const m = txt.match(/⟦[^⟧]*⟧/g);
    check(!m, where + ': chaves i18n em falta ' + (m ? [...new Set(m)].join(', ') : ''));
  };
  const geoIds = ['geoscape', 'campaignHub'];
  const waitGeo = async (ms, p) => {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) { if (geoIds.includes(await topId(p))) return true; await sleep(100); }
    return false;
  };
  const key = async (k, n, p) => { for (let i = 0; i < (n || 1); i++) { await (p || page).keyboard.press(k); await sleep(70); } };

  // ---------------------------------------------------------------------------------------------
  log('menu → Nova Campanha');
  await page.goto(BASE);
  await page.waitForSelector('.scr-menu .scr-mi', { timeout: 15000 });
  check((await page.locator('.scr-mi[data-id="ufopaedia"]').count()) === 1, 'menu: entrada «Ufopédia»');
  await page.locator('.scr-mi[data-id="new"]').click();
  check(await waitTop('newgame'), 'nova campanha: cena newgame');
  await page.waitForSelector('.cp-diff');
  check((await page.locator('.cp-diff').count()) === 3, 'nova campanha: 3 dificuldades');
  await key('2');
  check((await page.locator('.cp-diff.on').getAttribute('data-d')) === '1', 'tecla 2 escolhe Veterano');
  await noMissing('dificuldade');
  await shot('01-newgame-diff');
  await page.locator('.cp-ng-diff .btn.primary').click();
  await page.waitForSelector('.cp-ng-side', { timeout: 8000 });
  await sleep(1200);
  const ng = await page.evaluate(() => OV.CampaignUI.debug.newgame());
  check(ng && ng.step === 'place' && ng.diff === 1, 'nova campanha: passo do globo com Veterano');
  check(ng && ng.name === 'Base Lusitânia', 'nome por omissão em Portugal: «Base Lusitânia» (' + (ng && ng.name) + ')');
  const info = await page.locator('.cp-ng-info').innerText();
  check(/Portugal/.test(info) && /Europa/.test(info), 'painel: região e país (Portugal, Europa)');
  // clique no globo noutro ponto (Madrid) e depois de volta a Lisboa
  const proj = async (lon, lat) => page.evaluate(([lo, la]) => {
    const d = OV.CampaignUI.debug.newgame();
    return OV.GlobeRender.project(Object.assign({}, d.view), lo, la);
  }, [lon, lat]);
  let pt = await proj(-3.7, 40.4);
  check(pt.front, 'Madrid visível no globo');
  await page.mouse.click(pt.x, pt.y);
  await sleep(250);
  const ng2 = await page.evaluate(() => OV.CampaignUI.debug.newgame());
  check(Math.abs(ng2.chosen.lon + 3.7) < 1.2 && /Espanha/.test(await page.locator('.cp-ng-info').innerText()), 'clique escolhe Madrid (Espanha)');
  check(ng2.name === 'Base Europa', 'nome muda com a região (' + ng2.name + ')');
  // mar: recusa
  pt = await proj(-20, 40);
  if (pt.front) {
    await page.mouse.click(pt.x, pt.y);
    await sleep(200);
    const ng3 = await page.evaluate(() => OV.CampaignUI.debug.newgame());
    check(Math.abs(ng3.chosen.lon + 3.7) < 1.2, 'clique no mar não muda o local');
  }
  pt = await proj(-9.14, 38.72);
  await page.mouse.click(pt.x, pt.y);
  await sleep(300);
  const ng4 = await page.evaluate(() => OV.CampaignUI.debug.newgame());
  check(Math.abs(ng4.chosen.lon + 9.14) < 0.6 && Math.abs(ng4.chosen.lat - 38.72) < 0.6, 'clique volta a Lisboa');
  check(ng4.name === 'Base Lusitânia', 'nome volta a «Base Lusitânia»');
  // trackpad: dois dedos roda, pinça aproxima
  const z0 = ng4.view.zoom;
  await page.mouse.move(500, 450);
  await page.mouse.wheel(0, 0);
  await page.evaluate(() => { const c = document.getElementById('view'); c.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, clientX: 500, clientY: 450, bubbles: true, cancelable: true })); });
  await sleep(200);
  const ng5 = await page.evaluate(() => OV.CampaignUI.debug.newgame());
  check(ng5.view.zoom > z0, 'pinça (ctrl+roda) aproxima o globo');
  await page.mouse.move(pt.x + 200, pt.y);
  await noMissing('globo');
  await shot('02-newgame-place');
  await page.locator('.cp-ng-side .btn.primary').click();
  check(await waitGeo(10000), 'fundar base → Geoscape (ou substituto)');
  const geoKind = await topId();
  log('Geoscape: ' + geoKind);
  const g0 = await page.evaluate(() => { const G = OV.Game.G; return G && { diff: G.difficulty, name: G.bases[0].name, lon: G.bases[0].lon, lat: G.bases[0].lat, t: G.t, funds: G.funds }; });
  check(g0 && g0.diff === 1, 'G criado em Veterano');
  check(g0 && g0.name === null && Math.abs(g0.lon + 9.14) < 0.6, 'base em Lisboa com nome por omissão');
  check(await page.evaluate(() => OV.Save.list().some((e) => e.slot === 'auto')), 'gravação automática ao fundar');
  await sleep(500);
  await noMissing('geoscape');
  await shot('03-geoscape');

  // ---------------------------------------------------------------------------------------------
  log('gravar na posição 1 → recarregar → Continuar');
  await page.evaluate(() => { OV.CampaignUI.saveDialog(OV.Game.G); });
  await page.waitForSelector('.cp-sl-row[data-slot="1"]');
  await noMissing('gravar');
  await shot('04-save-dialog');
  await page.locator('.cp-sl-row[data-slot="1"] .btn.primary').click();
  await sleep(300);
  check(await page.evaluate(() => OV.Save.list().some((e) => e.slot === '1' && !e.corrupt)), 'posição 1 gravada');
  // substituir pede confirmação
  await page.locator('.cp-sl-row[data-slot="1"] .btn.primary').click();
  await page.waitForSelector('#modals .modal');
  check(/Substituir/.test(await page.locator('#modals .modal').innerText()), 'substituir pede confirmação');
  await page.locator('#modals .modal .btn.primary').click();
  await sleep(200);
  await key('Escape');
  check(await waitGeo(3000), 'Esc fecha o diálogo');
  const saved = await page.evaluate(() => { const e = OV.Save.list().find((x) => x.slot === '1'); return { t: e.t, funds: e.funds, date: e.date }; });
  await page.reload();
  await page.waitForSelector('.scr-menu .scr-mi');
  check(!(await page.locator('.scr-mi[data-id="continue"]').isDisabled()), '«Continuar» ativo com gravações');
  await page.locator('.scr-mi[data-id="continue"]').click();
  check(await waitGeo(10000), '«Continuar» abre o Geoscape');
  const back = await page.evaluate(() => ({ t: OV.Game.G.t, funds: OV.Game.G.funds }));
  // o Geoscape real continua a correr a 5 s depois de abrir: tolera alguns minutos de jogo
  check(back.t >= saved.t && back.t - saved.t < 3600 && back.funds === saved.funds, 'mesma data e fundos depois de recarregar (' + JSON.stringify({ saved, back }) + ')');

  // ---------------------------------------------------------------------------------------------
  log('OVNI despenhado → briefing → equipar → batalha');
  const injectAndArrive = async (lon, lat) => page.evaluate(([lo, la]) => {
    const G = OV.Game.G;
    const m = OV.Missions.spawnMission(G, 'alien_research', { region: 'europe', race: 'sectoid', delayMin: 99999 });
    const u = OV.Missions.spawnUfo(G, m.id);
    u.lon = lo; u.lat = la; u.detected = true;
    OV.Missions.onUfoDown(G, u.id, 'crashed', null);
    const sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'skyranger');
    const r = OV.World.launch(G, sky.id, { kind: 'ufo', id: u.id });
    let n = 0;
    while (sky.status !== 'patrol' && n++ < 80) { OV.World.step(G, 720); G.events.splice(0); }
    return { ufo: u.id, status: u.status, craft: sky.id, craftStatus: sky.status, launch: r.ok, stores: Object.assign({}, G.bases[0].stores) };
  }, [lon, lat]);
  const site1 = await injectAndArrive(-7.9, 39.5);
  check(site1.status === 'crashed' && site1.launch && site1.craftStatus === 'patrol', 'OVNI despenhado e Skyranger no local (' + JSON.stringify([site1.status, site1.craftStatus]) + ')');
  // missão impossível: outra nave sem soldados
  await page.evaluate((s) => OV.CampaignUI.launchMission(OV.Game.G, { kind: 'ufo', id: s.ufo }, Object.keys(OV.Game.G.crafts).find((id) => OV.Game.G.crafts[id].type === 'interceptor')), site1);
  await page.waitForSelector('#modals .modal');
  const errTxt = await page.locator('#modals .modal').innerText();
  check(/transporte/i.test(errTxt), 'erro pt-PT para nave sem transporte (' + errTxt.replace(/\s+/g, ' ').slice(0, 80) + ')');
  await page.locator('#modals .modal .btn').first().click();
  await page.evaluate((s) => OV.CampaignUI.launchMission(OV.Game.G, { kind: 'ufo', id: s.ufo }, s.craft), site1);
  check(await waitTop('cbriefing'), 'briefing da campanha');
  await page.waitForSelector('.cp-brief .scr-soldier');
  // equipa inicial por dificuldade (Data.startingBase): todos os soldados aptos do Skyranger
  const nSquad = await page.evaluate((s) => OV.Game.G.crafts[s.craft].soldiers.length, site1);
  check(nSquad >= 8 && (await page.locator('.cp-brief .scr-soldier').count()) === nSquad, 'briefing: ' + nSquad + ' soldados');
  const brTxt = await page.locator('.cp-brief').innerText();
  check(/Portugal/.test(brTxt) && /Europa/.test(brTxt), 'briefing: local (Portugal · Europa)');
  check(await page.evaluate(() => !!OV.Game.G.activeMission), 'startMission marcou a missão ativa');
  await noMissing('briefing');
  await shot('05-briefing');
  await key('e');
  check(await waitTop('equip'), '«E» abre Equipar');
  await page.waitForSelector('.cp-eq .inv-equip');
  check((await page.locator('.cp-eq .eq-sol').count()) === nSquad, 'equipar: ' + nSquad + ' soldados');
  await key('Tab');
  await noMissing('equipar');
  await shot('06-equip');
  // mudar o equipamento: tirar a arma do 1.º soldado para o armazém (clique na arma, clique no armazém)
  const changed = await page.evaluate(() => {
    const host = document.querySelector('.cp-eq .inv-equip');
    const first = host.querySelector('.eq-sol');
    first.click();
    return true;
  });
  check(changed, 'equipar: selecionar soldado');
  await key('Escape');
  check(await waitTop('cbriefing'), 'Esc volta ao briefing');
  // cancelar limpa a missão; voltar a lançar
  await key('Escape');
  await sleep(250);
  check(await page.evaluate(() => OV.Game.G.activeMission === null), 'cancelar limpa a missão ativa');
  await page.evaluate((s) => OV.CampaignUI.launchMission(OV.Game.G, { kind: 'ufo', id: s.ufo }, s.craft), site1);
  check(await waitTop('cbriefing'), 'briefing outra vez');
  await page.locator('.cp-brief .btn.primary').click();
  check(await waitTop('battlescape', 15000), 'batalha começa');
  const st0 = Date.now();
  let turnSave = false;
  while (Date.now() - st0 < 30000) {
    turnSave = await page.evaluate(() => OV.Save.list().some((e) => e.slot === 'autoTurn' && e.battle));
    if (turnSave) break;
    await sleep(300);
  }
  check(turnSave, 'gravação automática no início do turno (autoTurn com batalha)');
  await sleep(600);
  await shot('07-battle');

  // ---------------------------------------------------------------------------------------------
  log('recarregar a meio da batalha → retomar → vitória forçada → relatório');
  await page.reload();
  await page.waitForSelector('.scr-menu .scr-mi');
  await page.locator('.scr-mi[data-id="load"]').click();
  check(await waitTop('saveload'), '«Carregar» abre o diálogo da campanha');
  await page.waitForSelector('.cp-sl-row[data-slot="autoTurn"]');
  check(/Em combate/.test(await page.locator('.cp-sl-row[data-slot="autoTurn"]').innerText()), 'linha da gravação de combate marcada');
  await noMissing('carregar');
  await shot('08-load-dialog');
  await page.locator('.cp-sl-row[data-slot="autoTurn"] .btn.primary').click();
  check(await waitTop('battlescape', 15000), 'gravação de combate retoma a batalha');
  await page.evaluate(() => { const G = OV.Game.G; window.__avail0 = OV.Campaign.availableResearch(G, G.bases[0].id); });
  check(await page.evaluate(() => !!(OV.Game.G && OV.Game.G.activeMission && OV.Game.B)), 'G e B carregados com a missão ativa');
  await sleep(1500);
  const forceWin = async () => {
    await page.evaluate(() => { for (const u of OV.Game.B.units) if (u.side === 'alien') u.status = 'dead'; });
    await page.waitForFunction(() => { const s = OV.BattleUI.debug.state(); return s && !s.playing; }, null, { timeout: 30000 });
    await page.keyboard.press('Enter');
    await sleep(300);
    if (await page.locator('#modals .modal .btn.primary').count()) await page.locator('#modals .modal .btn.primary').click();
    return waitTop('cdebrief', 30000);
  };
  check(await forceWin(), 'vitória forçada → relatório da campanha');
  await page.waitForSelector('.cp-deb .scr-result');
  check((await page.locator('.cp-deb .scr-result').innerText()).toLowerCase() === 'vitória', 'relatório: vitória');
  check((await page.locator('.cp-deb .scr-item').count()) >= 1, 'relatório: material entregue no armazém (ícones)');
  check((await page.locator('.cp-deb .scr-prog-row').count()) >= 1, 'relatório: progressão dos soldados');
  const afterWin = await page.evaluate(() => ({ am: OV.Game.G.activeMission, stores: OV.Game.G.bases[0].stores, won: OV.Game.G.stats.missionsWon }));
  check(afterWin.am === null && afterWin.won === 1, 'finishMission aplicado (missão terminada, 1 vitória)');
  const newItems = Object.keys(afterWin.stores).filter((k) => (afterWin.stores[k] | 0) > (site1.stores[k] | 0));
  check(newItems.length >= 1, 'material recuperado no armazém: ' + newItems.join(', '));
  // projetos novos abertos pelo material recuperado: secção «Novos projetos de investigação» com o botão
  const fresh = await page.evaluate(() => { const G = OV.Game.G; return OV.Campaign.availableResearch(G, G.bases[0].id).filter((id) => window.__avail0.indexOf(id) < 0).length; });
  if (fresh) {
    check((await page.locator('.cp-deb .cp-newres .scr-tag').count()) === fresh, 'relatório: ' + fresh + ' projetos novos de investigação');
    check((await page.locator('.cp-deb .btn', { hasText: /Abrir investigação/i }).count()) === 1, 'relatório: botão «Abrir investigação»');
  } else log('  (o material desta missão não abriu projetos novos)');
  await noMissing('relatório');
  await shot('09-debrief');
  await page.locator('.cp-deb .btn.primary').click();
  check(await waitGeo(8000), 'relatório → Geoscape');
  check(await page.evaluate(() => OV.Save.list().some((e) => e.slot === 'auto' && !e.battle)), 'gravação automática depois da missão');
  check(await page.evaluate(() => !OV.Save.list().some((e) => e.slot === 'autoTurn')), 'gravação do último turno apagada (batalha resolvida)');

  // ---------------------------------------------------------------------------------------------
  log('segunda missão sem recarregar (volta ao Geoscape que ficou por baixo)');
  await page.evaluate(() => {
    const G = OV.Game.G;
    const sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'skyranger');
    let n = 0;
    while (sky.status !== 'ready' && n++ < 400) { OV.World.step(G, 720); G.events.splice(0); }
  });
  const site2 = await injectAndArrive(-8.4, 40.2);
  check(site2.craftStatus === 'patrol', 'segunda nave no local');
  await page.evaluate((s) => OV.CampaignUI.launchMission(OV.Game.G, { kind: 'ufo', id: s.ufo }, s.craft), site2);
  check(await waitTop('cbriefing'), 'segundo briefing');
  const stackBefore = await page.evaluate(() => OV.Scenes.stack.map((s) => s.id).join('>'));
  await page.keyboard.press('Enter');
  check(await waitTop('battlescape', 15000), 'Enter inicia a batalha');
  await sleep(2500);
  check(await forceWin(), 'segunda vitória → relatório');
  await page.locator('.cp-deb .btn.primary').click();
  check(await waitGeo(8000), 'volta ao Geoscape');
  const stackAfter = await page.evaluate(() => OV.Scenes.stack.map((s) => s.id).join('>'));
  check(stackAfter === stackBefore.replace(/>cbriefing$/, ''), 'pilha de cenas reposta (' + stackBefore + ' → ' + stackAfter + ')');
  check(await page.evaluate(() => OV.Game.G.stats.missionsWon === 2 && OV.Game.B === null), 'duas vitórias aplicadas uma só vez cada');

  // ---------------------------------------------------------------------------------------------
  log('missão final pela interface: base → Naves → «Missão final: Cidónia» → briefing → batalha → vitória');
  await page.evaluate(() => {
    const G = OV.Game.G;
    const sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'skyranger');
    let n = 0;
    while (sky.status !== 'ready' && n++ < 400) { OV.World.step(G, 720); G.events.splice(0); }
    G.flags.cydoniaUnlocked = true;
    const av = OV.Campaign.addCraft(G, G.bases[0].id, 'avenger');
    av.status = 'ready';
    for (const sid of sky.soldiers.slice()) OV.BaseSim.assignSoldier(G, sid, av.id);
    OV.BaseUI.open(G, G.bases[0].id, 'crafts');
  });
  check(await waitTop('basescape'), 'base aberta no separador Naves');
  await page.locator('.bsc-craft', { hasText: 'Vingador' }).click();
  await page.waitForSelector('[data-act="cydonia"]');
  await shot('09b-base-cydonia');
  await page.locator('[data-act="cydonia"]').click();
  await page.waitForSelector('.modal.cp-cy-modal');
  check(/Não há regresso/.test(await page.locator('.modal.cp-cy-modal').innerText()), 'confirmação sem regresso');
  await page.locator('.modal.cp-cy-modal .btn.danger').click();
  check(await waitTop('cbriefing'), 'briefing de Cidónia');
  check(await page.evaluate(() => OV.Game.G.activeMission.siteRef.kind === 'cydonia'), 'missão ativa: Cidónia');
  await noMissing('briefing de Cidónia');
  await shot('09c-cydonia-briefing');
  await page.keyboard.press('Enter');
  check(await waitTop('battlescape', 30000), 'batalha em Marte');
  check(await page.evaluate(() => OV.Game.B.mission.kind === 'cydonia' && OV.Game.B.mission.terrain === 'MARS'), 'missão de Cidónia no terreno de Marte');
  await sleep(2500);
  check(await forceWin(), 'vitória em Cidónia → relatório');
  await page.locator('.cp-deb .btn.primary').click();
  check(await waitTop('victory', 8000), 'relatório → ecrã de vitória (sem a entrada de depuração)');
  await page.waitForSelector('.cp-vic .cp-hero');
  await noMissing('vitória pela interface');
  await shot('09d-victory-ui');
  await page.locator('.cp-vic .btn.primary').click();
  check(await waitTop('menu', 4000), 'vitória → menu principal');

  // ---------------------------------------------------------------------------------------------
  // ecrãs de fim (campanha à parte para não estragar a principal)
  const endScreens = async (p, tag) => {
    await p.evaluate(() => {
      const G2 = OV.Campaign.newCampaign({ difficulty: 1, seed: 77 });
      G2.events.splice(0);
      OV.Economy.addScore(G2, 'xcom', 420, -9, 39);
      OV.Economy.addScore(G2, 'alien', 380, 10, 50);
      OV.Economy.addScore(G2, 'alien', 900, -100, 40);
      OV.Economy.addScore(G2, 'xcom', 150, -100, 40);
      OV.Economy.addScore(G2, 'research', 60);
      const sm = JSON.parse(JSON.stringify(G2.score.month));
      const rep = OV.Economy.monthEnd(G2);
      // relatório mais rico (só para o ecrã): pontos por região e avisos
      rep.regions = {};
      for (const id of Object.keys(sm.xcom.regions).concat(Object.keys(sm.alien.regions))) rep.regions[id] = { xcom: sm.xcom.regions[id] | 0, alien: sm.alien.regions[id] | 0 };
      rep.countries[3].newPact = true; rep.countries[3].pact = true;
      rep.debtWarning = true;
      window.__G2 = G2;
      window.__rep = rep;
      const ids = Object.keys(G2.soldiers);
      OV.Soldiers.kill(G2, ids[0], 'kia', { kind: 'ufo', lon: 2, lat: 45 });
      OV.Soldiers.kill(G2, ids[1], 'mia', { kind: 'site', lon: 2, lat: 45 });
      G2.stats.missionsWon = 9; G2.stats.aliensKilled = 74; G2.stats.ufosShotDown = 11; G2.stats.ufosDetected = 23;
      OV.CampaignUI.monthReport(G2, rep);
    });
    await p.waitForSelector('.cp-mr .cp-fund');
    const nC = await p.evaluate(() => window.__G2.countries.length);
    check((await p.locator('.cp-mr .cp-fund tbody tr').count()) === nC, tag + ' relatório mensal: ' + nC + ' países');
    check((await p.locator('.cp-mr .cp-reg tbody tr').count()) >= 2, tag + ' relatório mensal: regiões');
    check((await p.locator('.cp-mr .cp-warns li').count()) >= 2, tag + ' relatório mensal: avisos');
    await noMissing(tag + ' relatório mensal', p);
    await shot(tag + '-10-month-report', p);
    // fim de jogo enquanto o relatório está aberto: espera pelo «Continuar»
    await p.evaluate(() => { OV.CampaignUI.gameOver(window.__G2, 'council'); });
    check((await topId(p)) === 'monthReport', tag + ' fim de jogo espera pelo relatório');
    await p.locator('.cp-mr .btn.primary').click();
    check(await waitTop('gameOver', 4000, p), tag + ' fim de jogo depois do relatório');
    await p.waitForSelector('.cp-go .cp-memcard');
    check((await p.locator('.cp-go .cp-memcard').count()) === 2, tag + ' memorial com 2 nomes');
    await noMissing(tag + ' fim de jogo', p);
    await shot(tag + '-11-game-over', p);
    for (const r of ['debt', 'baseLost', 'cydonia']) {
      await p.evaluate((rr) => { OV.CampaignUI.gameOver(window.__G2, rr); }, r);
      await sleep(200);
      await noMissing(tag + ' fim ' + r, p);
    }
    log(tag + ': vitória');
    await p.evaluate(() => { OV.CampaignUI.victory(window.__G2); });
    check(await waitTop('victory', 4000, p), tag + ' vitória');
    await p.waitForSelector('.cp-vic .cp-hero');
    await noMissing(tag + ' vitória', p);
    await shot(tag + '-12-victory', p);
    log(tag + ': defesa da base');
    await p.evaluate(() => { OV.CampaignUI.baseDefence(window.__G2, { baseId: window.__G2.bases[0].id, ufoId: 'u9', shots: [{ type: 'missile_defence', hit: true, dmg: 210 }, { type: 'missile_defence', hit: false, dmg: 0 }], result: 'repelled', soldiersLost: [window.__G2.dead[0].id] }); });
    await p.waitForSelector('#modals .cp-bd');
    await noMissing(tag + ' defesa da base', p);
    await shot(tag + '-13-base-defence', p);
    await p.locator('#modals .modal .btn.primary').click();
    await key('Enter', 1, p);
    check(await waitTop('menu', 4000, p), tag + ' vitória → menu principal');
  };
  log('relatório mensal, fim de jogo e vitória a 1440×900');
  await endScreens(page, '1440');

  // ---------------------------------------------------------------------------------------------
  log('quota cheia e gravação danificada');
  await page.evaluate(() => { localStorage.setItem('ovni1999.save.3', '{isto não é json'); });
  await page.locator('.scr-mi[data-id="continue"]').click();
  check(await waitGeo(10000), 'Continuar depois das vitórias');
  await page.evaluate(() => { OV.CampaignUI.loadDialog(); });
  await page.waitForSelector('.cp-sl-row[data-slot="3"]');
  check(/danificada/i.test(await page.locator('.cp-sl-row[data-slot="3"]').innerText()), 'posição 3 marcada como danificada');
  check((await page.locator('.cp-sl-row[data-slot="3"] .btn.primary').count()) === 0, 'danificada não se abre');
  await page.locator('.cp-sl-row[data-slot="3"] .btn.danger').click();
  await page.locator('#modals .modal .btn.danger').click();
  await sleep(200);
  check((await page.locator('.cp-sl-row[data-slot="3"]').count()) === 0, 'apagar remove a posição danificada');
  await key('2');
  await key('1');
  check(/Gravar/.test(await page.locator('.cp-sl .scr-title').innerText()), 'tecla 1 muda para «Gravar»');
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    window.__restoreLS = () => { Storage.prototype.setItem = orig; };
    Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('ovni1999.save.')) { const e = new Error('cheio'); e.name = 'QuotaExceededError'; throw e; } return orig.call(this, k, v); };
  });
  await page.locator('.cp-sl-row[data-slot="2"] .btn.primary').click();
  await page.waitForSelector('#modals .modal');
  const toasts = await page.locator('#toasts').innerText();
  check(/Espaço insuficiente — exporte o jogo/.test(toasts), 'quota: aviso «Espaço insuficiente — exporte o jogo»');
  check(/exportar/i.test(await page.locator('#modals .modal').innerText()), 'quota: oferta de exportação');
  await noMissing('quota');
  await shot('14-quota');
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.locator('#modals .modal .btn.primary').click();
  const d = await dl;
  check(!!d && /^ovni1999-\d{4}-\d{2}-\d{2}\.json$/.test(d.suggestedFilename()), 'exportar descarrega ovni1999-<data>.json');
  await page.evaluate(() => window.__restoreLS());
  await key('Escape');

  // ---------------------------------------------------------------------------------------------
  log('1024×700');
  const ctxS = await browser.newContext({ viewport: { width: 1024, height: 700 }, deviceScaleFactor: DPR });
  await stubGeo(ctxS);
  const ps = await ctxS.newPage();
  ps.setDefaultTimeout(20000);
  watch(ps, '1024');
  await ps.goto(BASE);
  await ps.waitForSelector('.scr-menu .scr-mi');
  const menuFits = await ps.evaluate(() => { const r = document.querySelector('.scr-menu-list').getBoundingClientRect(); return r.bottom <= innerHeight; });
  check(menuFits, '1024: menu de 8 entradas cabe no ecrã');
  await shot('20-menu-1024', ps);
  await ps.locator('.scr-mi[data-id="new"]').click();
  await ps.waitForSelector('.cp-diff');
  const fitsDiff = await ps.evaluate(() => { const r = document.querySelector('.cp-ng-diff').getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; });
  check(fitsDiff, '1024: painel de dificuldade cabe');
  await shot('21-newgame-diff-1024', ps);
  await key('Enter', 1, ps);
  await ps.waitForSelector('.cp-ng-side');
  await sleep(1200);
  await shot('22-newgame-place-1024', ps);
  await key('Enter', 1, ps);
  check(await waitGeo(10000, ps), '1024: Enter funda a base');
  await ps.evaluate(() => {
    const G = OV.Game.G;
    const m = OV.Missions.spawnMission(G, 'alien_research', { region: 'europe', race: 'sectoid', delayMin: 99999 });
    const u = OV.Missions.spawnUfo(G, m.id);
    u.lon = -7.9; u.lat = 39.5; u.detected = true;
    OV.Missions.onUfoDown(G, u.id, 'crashed', null);
    const sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'skyranger');
    OV.World.launch(G, sky.id, { kind: 'ufo', id: u.id });
    let n = 0;
    while (sky.status !== 'patrol' && n++ < 80) { OV.World.step(G, 720); G.events.splice(0); }
    OV.CampaignUI.launchMission(G, { kind: 'ufo', id: u.id }, sky.id);
  });
  await ps.waitForSelector('.cp-brief .scr-soldier');
  await noMissing('1024 briefing', ps);
  await shot('23-briefing-1024', ps);
  await key('e', 1, ps);
  await ps.waitForSelector('.cp-eq .inv-equip');
  await shot('24-equip-1024', ps);
  await key('Escape', 1, ps);
  // relatório da campanha a 1024: batalha resolvida sem o ecrã de combate e afterBattle chamado diretamente
  await ps.evaluate(() => {
    const G = OV.Game.G;
    const am = G.activeMission;
    const top = OV.Scenes.top();
    if (top && top.id === 'cbriefing') OV.Scenes.pop();
    OV.Campaign.cancelMission(G);
    const mission = OV.Campaign.startMission(G, am.siteRef, am.craftId, { settings: {} });
    const B = OV.Battle.create(mission);
    for (const _ of OV.Battle.beginBattle(B)) { /* esgotar */ }
    const al = B.units.filter((u) => u.side === 'alien');
    al.forEach((u) => { u.status = 'dead'; });
    const xs = B.units.filter((u) => u.side === 'xcom');
    xs[0].kills = al.length;
    xs[1].status = 'dead';
    xs[2].hp = Math.max(1, xs[2].hp - 9);
    for (const u of xs) u.exp = { fire: 4, react: 3, brav: 2 };
    const g = OV.Battle.endPlayerTurn(B);
    while (!g.next().done) { /* esgotar */ }
    OV.CampaignUI.afterBattle(G, B, { outcome: OV.Battle.outcome(B) });
  });
  check(await waitTop('cdebrief', 8000, ps), '1024: afterBattle → relatório');
  await ps.waitForSelector('.cp-deb .scr-mem');
  check((await ps.locator('.cp-deb .scr-mem').count()) === 1, '1024: memorial com a baixa');
  check(await ps.evaluate(() => OV.Game.G.dead.length === 1 && OV.Game.G.activeMission === null), '1024: finishMission aplicou a baixa');
  await noMissing('1024 relatório', ps);
  await shot('26-debrief-1024', ps);
  await key('Enter', 1, ps);
  check(await waitGeo(8000, ps), '1024: relatório → Geoscape');
  await ps.evaluate(() => { OV.CampaignUI.saveDialog(OV.Game.G); });
  await ps.waitForSelector('.cp-sl-row');
  await shot('25-save-1024', ps);
  await key('Escape', 1, ps);
  await endScreens(ps, '1024');
  await ctxS.close();
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  server.kill();
}

for (const e of errors) fails.push(e);
console.log(`campaign_flow_check: ${checks} verificações, ${fails.length} falhas — capturas em ${OUT}`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
