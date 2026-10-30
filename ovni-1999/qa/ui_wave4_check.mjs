/* Correções da interface da vaga 4 num Chromium real (Playwright), pela interface sempre que possível:
   - missão final: «Missão final: Cidónia» no cartão da base do Geoscape, no aviso «Investigação concluída» e no separador
     Naves da base → confirmação «sem regresso» → briefing de Cidónia (e os estados bloqueados com o motivo);
   - «Enviar equipa»: Skyranger no topo, título próprio, ↑/↓ escolhem a linha; sugestão de velocidade depois de lançar;
   - interceção: abre em Normal com a dica das posturas; minimizada, o Geoscape diz que o tempo está parado, não
     responde ao rato e as teclas explicam-se; Esc reabre;
   - ficha «pessoal parado» no botão Bases e «Próximos passos»; nave de assalto a caminho da base; vender nave;
   - Esc mantido premido sai só de um ecrã; relatório mensal sem toasts por cima e com os totais; nova campanha que
     substituiria a gravação automática pergunta antes; importar um ficheiro danificado mostra save.err.parse;
   - textos de toque no iPad (1180×820) e toasts fora do painel lateral no retrato (820×1180).
   Uso: node ovni-1999/qa/ui_wave4_check.mjs [--out <pasta>] [--port <n>]
   Capturas fora do repositório. Falha com erros de consola/página, chaves ⟦em falta⟧ ou verificações falhadas. */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'wave4ui')
  : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'wave4ui') : path.join(process.cwd(), 'qa-out', 'wave4ui');
const OUT = path.resolve(arg('--out', DEF_OUT));
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
const errors = [];
let checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fails.push(msg); console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };
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
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) { /* a arrancar */ }
    await sleep(120);
  }
  return false;
}

const port = +arg('--port', 0) || (await freePort());
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/index.html?nosw=1&debug=1`;
const browser = await chromium.launch();

async function newPage(o) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, o || {}));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 20000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* sem armazenamento */ } });
  return { ctx, page };
}
const top = (p) => p.evaluate(() => (OV.Scenes.top() || {}).id);
const stack = (p) => p.evaluate(() => OV.Scenes.stack.map((s) => s.id));
async function waitTop(p, id, ms) {
  const end = Date.now() + (ms || 6000);
  while (Date.now() < end) { if ((await top(p)) === id) return true; await sleep(80); }
  return false;
}
async function noMissing(p, where) {
  const txt = await p.evaluate(() => document.body.innerText);
  const m = txt.match(/⟦[^⟧]*⟧/g);
  check(!m, where + ': sem chaves em falta' + (m ? ' ' + [...new Set(m)].join(', ') : ''));
}
const shot = async (p, name) => { await sleep(260); await p.screenshot({ path: path.join(OUT, name + '.png') }); };
// campanha nova (Veterano, Lisboa) e Geoscape aberto sem a janela de boas-vindas
async function campaign(p, seed) {
  await p.evaluate((sd) => {
    const G = OV.Campaign.newCampaign({ seed: sd, difficulty: 1, baseLonLat: { lon: -9.14, lat: 38.72 } });
    G.ui.geoIntro = true;
    OV.GeoUI.open(G);
  }, seed || 314);
  await waitTop(p, 'geoscape');
  await sleep(400);
}
async function step(name, fn) {
  log(name);
  try { await fn(); } catch (e) { check(false, name + ': exceção ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');
  const { page } = await newPage();

  await step('Geoscape: primeiros passos, pessoal parado e «Intercetar»', async () => {
    await campaign(page);
    check(await page.locator('.geo-steps:not(.hidden) li').count() === 4, '«Próximos passos» com 4 itens no primeiro mês');
    check(await page.locator('.geo-acts .geo-badge:not(.hidden)').count() === 1, 'ficha «!» no botão Bases (10 cientistas parados)');
    check((await page.locator('.geo-int-b').innerText()).includes('Intercetar'), 'botão «Intercetar» (AO90)');
    await shot(page, '01_geo_steps_1280');
    await noMissing(page, 'Geoscape');
    await page.locator('.geo-steps .geo-x').click();
    check(await page.locator('.geo-steps:not(.hidden)').count() === 0, '«×» esconde os passos');
    check(await page.evaluate(() => OV.Game.G.ui.geo.stepsOff === true), 'escolha guardada em G.ui');
  });

  await step('«Enviar equipa» a um OVNI aterrado: Skyranger primeiro, ↑/↓, sugestão de velocidade', async () => {
    await page.evaluate(() => {
      const G = OV.Game.G;
      G.ufos.push({ id: 'u90', type: 'small_scout', status: 'landed', lon: -3.7, lat: 40.4, speed: 0, alt: 0, dmg: 0, detected: true, hyper: false, race: 'sectoid', missionId: null, dest: null, crashLeftS: 0, targetBaseId: null, landedLeftS: 40000 });
      OV.Campaign.event(G, 'ufoLanded', { ufoId: 'u90' });
      OV.GeoUI.setSpeed(0);
    });
    await page.waitForSelector('.geo-pop');
    const pop = await page.locator('.geo-pop').innerText();
    check(/Skyranger-1 chega em/i.test(pop) && /(de dia|crepúsculo|noite)/i.test(pop), '«OVNI aterrou» diz quando a equipa chega e com que luz');
    await shot(page, '02a_ufo_landed_eta');
    await page.keyboard.press('Enter');
    await page.evaluate(() => { OV.GeoUI.togglePause(); OV.GeoUI.select({ kind: 'ufo', id: 'u90' }); });
    await sleep(300);
    await page.locator('.geo-card .btn', { hasText: 'Enviar equipa' }).click();
    await page.waitForSelector('.geo-int .geo-row');
    const rows = await page.locator('.geo-int .geo-row b').allInnerTexts();
    check(/Skyranger/.test(rows[0]), 'primeira linha: Skyranger (' + rows.join(' | ') + ')');
    check((await page.locator('.geo-int .geo-dlg-h h2').innerText()).includes('leva a equipa'), 'título «Que nave leva a equipa…»');
    check(/não leva soldados/i.test(await page.locator('.geo-int .geo-row').nth(1).innerText()), 'intercetor avisa que não leva soldados');
    await sleep(100);
    const f0 = await page.evaluate(() => document.activeElement && document.activeElement.innerText.split('\n')[0]);
    await page.keyboard.press('ArrowDown');
    const f1 = await page.evaluate(() => document.activeElement && document.activeElement.innerText.split('\n')[0]);
    const lon = await page.evaluate(() => OV.GeoUI.current().view.lon);
    check(f0 !== f1 && /Intercetor/.test(f1), '↓ muda a linha com foco (' + f0 + ' → ' + f1 + ')');
    await page.keyboard.press('ArrowUp');
    const lon2 = await page.evaluate(() => OV.GeoUI.current().view.lon);
    check(Math.abs(lon - lon2) < 0.01, '↑/↓ não rodam o globo com o diálogo aberto');
    await shot(page, '02_send_team');
    await page.keyboard.press('Enter');
    await sleep(400);
    const c1 = await page.evaluate(() => ({ st: OV.Game.G.crafts.c1.status, dest: OV.Game.G.crafts.c1.dest }));
    check(c1.st === 'out' && c1.dest && c1.dest.id === 'u90', 'Enter lança o Skyranger para o OVNI');
    check(await page.locator('.geo-nudge:not(.hidden)').count() === 1, 'sugestão discreta de acelerar o tempo');
    check(/acelera/.test(await page.locator('.geo-nudge').innerText()), 'texto «… chega em … — N acelera»');
    await shot(page, '03_speed_nudge');
    await page.locator('.geo-nudge .btn.primary').click();
    const sp = await page.evaluate(() => OV.GeoUI.current().speed);
    check(sp >= 2, '«Acelerar» muda a velocidade (' + sp + ')');
    check(await page.locator('.geo-nudge:not(.hidden)').count() === 0, 'a sugestão desaparece');
    await page.evaluate(() => { OV.GeoUI.togglePause(); OV.World.recall(OV.Game.G, 'c1'); });
  });

  await step('Missão final pelo cartão da base do Geoscape', async () => {
    await page.evaluate(() => {
      const G = OV.Game.G;
      G.flags.cydoniaUnlocked = true;
      OV.GeoUI.select({ kind: 'base', id: 'b1' });
    });
    await sleep(350);
    const btn = page.locator('.geo-card-acts .btn.cydonia');
    check(await btn.count() === 1, 'cartão da base: «Missão final: Cidónia»');
    check(await btn.evaluate((b) => b.classList.contains('disabled')), 'sem Vingador: botão bloqueado');
    await btn.click({ force: true }); // aria-disabled: o clique explica o motivo (Playwright exige force)
    await sleep(250);
    check(/Vingador/.test(await page.locator('#toasts').innerText()), 'clique bloqueado explica: falta um Vingador');
    await shot(page, '04_cydonia_locked');
    // um Vingador pronto no hangar com 8 soldados
    await page.evaluate(() => {
      const G = OV.Game.G;
      G.crafts.c1.status = 'ready';
      const av = OV.Campaign.addCraft(G, 'b1', 'avenger');
      av.status = 'ready';
      for (const sid of G.crafts.c1.soldiers.slice()) OV.BaseSim.assignSoldier(G, sid, av.id);
      window.__av = av.id;
      OV.GeoUI.select(null);
      OV.GeoUI.select({ kind: 'base', id: 'b1' });
    });
    await sleep(350);
    check(!(await page.locator('.geo-card-acts .btn.cydonia').evaluate((b) => b.classList.contains('disabled'))), 'Vingador pronto: botão ativo');
    check(await page.locator('.geo-cc .btn.cydonia').count() === 1, 'linha do Vingador no cartão: «Cidónia»');
    await shot(page, '05_cydonia_card');
    await page.locator('.geo-card-acts .btn.cydonia').click();
    await page.waitForSelector('.modal.cp-cy-modal');
    check(/Não há regresso/.test(await page.locator('.modal.cp-cy-modal').innerText()), 'confirmação «Não há regresso»');
    await shot(page, '06_cydonia_confirm');
    await noMissing(page, 'confirmação de Cidónia');
    await page.locator('.modal.cp-cy-modal .btn', { hasText: 'Partir para Marte' }).click();
    check(await waitTop(page, 'cbriefing'), 'briefing da missão final');
    const am = await page.evaluate(() => OV.Game.G.activeMission && OV.Game.G.activeMission.siteRef);
    check(am && am.kind === 'cydonia', 'missão ativa: Cidónia');
    await sleep(400);
    await shot(page, '07_cydonia_briefing');
    await noMissing(page, 'briefing de Cidónia');
    await page.keyboard.press('Escape');
    check(await waitTop(page, 'geoscape'), 'Esc cancela o briefing');
    check(await page.evaluate(() => !OV.Game.G.activeMission), 'missão cancelada');
  });

  await step('Missão final pelo aviso «Investigação concluída»', async () => {
    await page.evaluate(() => {
      const G = OV.Game.G;
      OV.GeoUI.select(null);
      OV.Campaign.event(G, 'researchDone', { baseId: 'b1', topic: 'cydonia', article: 'cydonia', unlocked: [], manufacture: [], flags: ['cydoniaUnlocked'] });
      OV.GeoUI.setSpeed(0);
    });
    await page.waitForSelector('.geo-pop', { timeout: 6000 });
    const txt = await page.locator('.geo-pop').innerText();
    check(/Cidónia ao alcance/i.test(txt) && /pronto/.test(txt), 'aviso «Cidónia ao alcance» com o Vingador pronto');
    await shot(page, '08_cydonia_research_popup');
    await page.locator('.geo-pop .btn', { hasText: 'Missão final' }).click();
    await page.waitForSelector('.modal.cp-cy-modal');
    await page.locator('.modal.cp-cy-modal .btn', { hasText: 'Ainda não' }).click();
    await sleep(250);
    check((await top(page)) === 'geoscape' && (await page.evaluate(() => !OV.Game.G.activeMission)), '«Ainda não» volta ao Geoscape sem missão');
  });

  await step('Missão final e venda de nave no separador Naves da base', async () => {
    await page.keyboard.press('b');
    check(await waitTop(page, 'basescape'), 'base aberta (B)');
    await page.keyboard.press('6');
    await sleep(300);
    await page.locator('.bsc-craft', { hasText: 'Vingador' }).click();
    await sleep(250);
    check(await page.locator('[data-act="cydonia"]').count() === 1, 'Naves: «Missão final: Cidónia» no Vingador');
    await shot(page, '09_base_crafts_cydonia');
    await noMissing(page, 'base · Naves');
    // vender o Intercetor-2
    await page.locator('.bsc-craft', { hasText: 'Intercetor-2' }).click();
    await sleep(250);
    const funds0 = await page.evaluate(() => OV.Game.G.funds);
    await page.locator('[data-act="sellCraft"]').click();
    await page.waitForSelector('.modal');
    check(/450/.test(await page.locator('.modal').innerText()), 'confirmação com o preço');
    await shot(page, '10_sell_craft_confirm');
    await page.locator('.modal .btn.danger').click();
    await sleep(300);
    const after = await page.evaluate(() => ({ funds: OV.Game.G.funds, c3: !!OV.Game.G.crafts.c3, stores: OV.Game.G.bases[0].stores.cannon | 0 }));
    check(after.funds === funds0 + 450000 && !after.c3, 'Intercetor-2 vendido por $450 000');
    // Skyranger com soldados? (os soldados passaram para o Vingador) → o Vingador com equipa não se vende
    await page.locator('.bsc-craft', { hasText: 'Vingador' }).click();
    await sleep(200);
    check(await page.locator('[data-act="sellCraft"].disabled').count() === 1, 'nave com soldados: «Vender nave» bloqueado');
    // X: missão final a partir da base
    await page.keyboard.press('x');
    await page.waitForSelector('.modal.cp-cy-modal');
    await page.locator('.modal.cp-cy-modal .btn', { hasText: 'Partir para Marte' }).click();
    check(await waitTop(page, 'cbriefing'), 'X na base → briefing de Cidónia');
    await page.keyboard.press('Escape');
    check(await waitTop(page, 'basescape'), 'cancelar o briefing volta à base');
  });

  await step('Esc mantido premido sai só de um ecrã', async () => {
    await page.keyboard.press('u');
    check(await waitTop(page, 'ufopaedia'), 'Ufopédia aberta da base');
    const s0 = (await stack(page)).length;
    await page.keyboard.down('Escape');
    for (let i = 0; i < 4; i++) { await sleep(40); await page.keyboard.down('Escape'); }
    await page.keyboard.up('Escape');
    await sleep(300);
    const s1 = await stack(page);
    check(s1.length === s0 - 1 && s1[s1.length - 1] === 'basescape', 'Esc com repetição: um nível só (' + s1.join('>') + ')');
    await page.keyboard.press('Escape');
    check(await waitTop(page, 'geoscape'), 'nova pressão de Esc volta ao Geoscape');
  });

  await step('Interceção: abre em Normal, dica das posturas; minimizada o Geoscape fica parado e explica-se', async () => {
    await page.evaluate(() => {
      const G = OV.Game.G;
      const b = G.bases[0];
      // OVNI de ensaio sem missão: destino longe (nunca chega a um ponto de passagem durante o ensaio)
      G.ufos.push({ id: 'u91', type: 'small_scout', status: 'flying', lon: b.lon + 0.3, lat: b.lat + 0.2, speed: 900, alt: 2, dmg: 0, detected: true, hyper: false, race: 'sectoid', missionId: null, dest: { lon: b.lon + 80, lat: b.lat - 30 }, crashLeftS: 0, targetBaseId: null });
      OV.World.launch(G, 'c2', { kind: 'ufo', id: 'u91' });
      const d = OV.Dogfight.create(G, 'c2', 'u91');
      OV.Campaign.event(G, 'dogfightStart', { dogfightId: d.id, craftId: 'c2', ufoId: 'u91' });
      OV.GeoUI.setSpeed(0);
    });
    check(await waitTop(page, 'dogfight', 6000), 'janela de interceção aberta');
    await sleep(500);
    const mode = await page.evaluate(() => OV.Game.G.dogfights[0] && OV.Game.G.dogfights[0].mode);
    check(mode === 'standard', 'abre em Normal (' + mode + ')');
    check(await page.locator('.df-hint').count() === 1, 'dica das posturas (primeiro combate)');
    // com a pergunta «Desligar mísseis?» aberta o aviso sai (ronda de personas 2): a pergunta diz o mesmo
    check(await page.locator('.df-tip:not(.hidden)').count() === 1 || await page.locator('.df-ask:not(.hidden)').count() === 1, 'batedor pequeno com mísseis: aviso «Q desliga-os» (ou a pergunta)');
    await shot(page, '11_dogfight_open');
    await noMissing(page, 'interceção');
    await page.keyboard.press('q');
    await sleep(150);
    check(await page.locator('.df-tip:not(.hidden)').count() === 0, 'Q desliga o Stingray e o aviso some');
    await page.keyboard.press('m');
    await sleep(300);
    check(/interceção em curso/i.test(await page.locator('.geo-banner').innerText()), 'Geoscape: «Tempo parado: interceção em curso»');
    check(await page.evaluate(() => !document.querySelector('.geo-run').classList.contains('on')), 'indicador de tempo apagado');
    check(await page.evaluate(() => document.querySelector('.geo').inert === true), 'painel do Geoscape inerte por baixo');
    await page.locator('.geo-int-b').click({ force: true });
    await sleep(200);
    check(await page.evaluate(() => !OV.GeoUI.current().dialog), 'clique em «Intercetar» por baixo não abre nada');
    await page.keyboard.press('b');
    await sleep(200);
    check((await top(page)) === 'dogfight' && /Interceção em curso/.test(await page.locator('#toasts').innerText()), 'B minimizado explica-se e não muda de cena');
    await shot(page, '12_dogfight_minimised');
    // o cartão da nave em combate acompanha o casco (o Geoscape por baixo é atualizado sem avançar o tempo)
    await page.evaluate(() => { OV.GeoUI.select({ kind: 'craft', id: 'c2' }); OV.Game.G.crafts.c2.hp = 63; });
    await sleep(800);
    check(/63 %/.test(await page.locator('.geo-card').innerText()), 'cartão da nave atualizado durante a interceção (casco 63 %)');
    await page.evaluate(() => { OV.Game.G.crafts.c2.hp = 100; });
    await page.keyboard.press('Escape');
    await sleep(200);
    check(await page.evaluate(() => OV.DogfightUI.active().some((p) => !p.minimised)), 'Esc reabre a interceção');
    await page.keyboard.press('5');
    const end = Date.now() + 30000;
    while (Date.now() < end && (await top(page)) === 'dogfight') {
      const over = await page.evaluate(() => OV.DogfightUI.active().some((p) => p.over));
      if (over) { await sleep(400); await page.keyboard.press('Enter'); }
      await sleep(250);
    }
    check((await top(page)) === 'geoscape', 'interceção fechada');
    await page.evaluate(() => { const G = OV.Game.G; if (!OV.GeoUI.current().paused) OV.GeoUI.togglePause(); G.ufos = G.ufos.filter((u) => u.id !== 'u91'); });
    check(await page.evaluate(() => document.querySelector('.geo').inert === false && !document.querySelector('.geo-banner:not(.hidden)')), 'o Geoscape volta a responder e a faixa some');
    for (let i = 0; i < 6 && (await page.locator('.geo-pop').count()); i++) { await page.keyboard.press('Enter'); await sleep(250); }
  });

  await step('Nave de assalto a caminho da base', async () => {
    await page.evaluate(() => {
      const G = OV.Game.G;
      const b = G.bases[0];
      G.ufos.push({ id: 'u92', type: 'battleship', status: 'flying', lon: b.lon + 12, lat: b.lat + 4, speed: 4000, alt: 3, dmg: 0, detected: true, hyper: false, race: 'sectoid', missionId: null, dest: { lon: b.lon, lat: b.lat }, crashLeftS: 0, targetBaseId: b.id });
      OV.Campaign.event(G, 'ufoDetected', { ufoId: 'u92', hyper: false });
      OV.GeoUI.setSpeed(0);
    });
    await page.waitForSelector('.geo-pop');
    const txt = await page.locator('.geo-pop').innerText();
    check(/Nave de assalto a caminho da base/i.test(txt) && /Intercetar/i.test(txt), 'aviso da nave de assalto com «Intercetar»');
    await shot(page, '13_assault_popup');
    await page.keyboard.press('Enter');
    await page.evaluate(() => { const G = OV.Game.G; G.ufos = G.ufos.filter((u) => u.id !== 'u92'); });
  });

  await step('Relatório mensal: sem toasts por cima, totais e parcela do terror', async () => {
    const r = await page.evaluate(() => {
      const G = OV.Game.G;
      OV.Economy.addScore(G, 'alien', 1000, 2.35, 48.85);
      G.ui.terrorLog = { [G.month]: { n: 1, pts: 1000 } };
      const R = OV.Economy.monthEnd(G);
      OV.CampaignUI.monthReport(G, R);
      OV.Dom.toast('teste de toast', null, 'info');
      return { alien: R.alien };
    });
    check(await waitTop(page, 'monthReport'), 'relatório mensal aberto');
    await sleep(500);
    check(await page.evaluate(() => getComputedStyle(document.getElementById('toasts')).display === 'none'), 'toasts escondidos com o relatório aberto');
    const t = await page.locator('.cp-mr').innerText();
    check(/ataque terrorista sem resposta/i.test(t) && /OVNIs e bases/i.test(t), 'pontos alienígenas separados (terror ' + r.alien + ')');
    check(/Próximo mês/i.test(t) && /Receita do próximo mês/i.test(t), 'coluna «Próximo mês» e receita do próximo mês');
    const tf = await page.evaluate(() => {
      const f = document.querySelector('.cp-fund tfoot');
      const b = document.querySelector('.cp-mr-body');
      b.scrollTop = b.scrollHeight;
      const fr = f.getBoundingClientRect(), br = b.getBoundingClientRect();
      return { ok: fr.bottom <= br.bottom + 1 && fr.top >= br.top - 1, cells: [...f.querySelectorAll('td')].map((x) => x.textContent) };
    });
    check(tf.ok && tf.cells.length === 4 && tf.cells[1] && tf.cells[3], 'rodapé com Antes · Variação · Próximo mês visível (' + tf.cells.join(' | ') + ')');
    await page.evaluate(() => { document.querySelector('.cp-mr-body').scrollTop = 0; });
    await shot(page, '14_month_report_1280');
    await noMissing(page, 'relatório mensal');
    await page.keyboard.press('Enter');
    await sleep(300);
    check(await page.evaluate(() => getComputedStyle(document.getElementById('toasts')).display !== 'none'), 'os toasts voltam depois de fechar');
    for (let i = 0; i < 6 && (await page.locator('.geo-pop').count()); i++) { await page.keyboard.press('Enter'); await sleep(250); }
  });

  await step('Nova campanha não substitui a gravação automática sem perguntar', async () => {
    await page.evaluate(() => {
      OV.CampaignUI.autosave(OV.Game.G, { silent: true });
      OV.Save.save('autoTurn', OV.Game.G, null, { label: 'turno antigo' });
      OV.Game.G = null;
      OV.Scenes.set('menu');
    });
    await waitTop(page, 'menu');
    await page.locator('.scr-mi[data-id="new"]').click();
    await waitTop(page, 'newgame');
    await page.locator('.cp-ng-diff .btn.primary').click();
    await page.waitForSelector('.cp-ng-side');
    await sleep(900);
    const coords = await page.locator('.cp-ng-info').innerText();
    check(/\d+,\d° N/.test(coords) && !/\d+\.\d°/.test(coords), 'coordenadas com vírgula decimal (' + coords.split('\n').slice(0, 2).join(' ') + ')');
    await page.locator('.cp-ng-side .btn.primary').click();
    await page.waitForSelector('.modal');
    check(/gravação automática/i.test(await page.locator('.modal').innerText()), 'pergunta antes de substituir a gravação automática');
    await shot(page, '15_newgame_auto_confirm');
    await page.locator('.modal .btn', { hasText: 'Cancelar' }).click();
    await sleep(200);
    check((await top(page)) === 'newgame', 'Cancelar fica na escolha do local');
    await page.locator('.cp-ng-side .btn.primary').click();
    await page.waitForSelector('.modal');
    await page.locator('.modal .btn', { hasText: 'Substituir' }).click();
    check(await waitTop(page, 'geoscape'), '«Substituir» funda a base');
    const slots = await page.evaluate(() => OV.Save.list().map((e) => e.slot));
    check(slots.indexOf('autoTurn') < 0, 'o turno de batalha antigo foi apagado (' + slots.join(',') + ')');
  });

  await step('Importar um ficheiro danificado mostra «gravação danificada»', async () => {
    for (let i = 0; i < 4 && (await page.locator('.geo-pop').count()); i++) { await page.keyboard.press('Enter'); await sleep(250); }
    await page.evaluate(() => OV.CampaignUI.loadDialog());
    check(await waitTop(page, 'saveload'), 'diálogo de carregar');
    await shot(page, '15b_load_dialog');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cp-sl .btn', { hasText: /Importar/i }).click()]);
    await fc.setFiles({ name: 'estragada.json', mimeType: 'application/json', buffer: Buffer.from('{"game":"ovni-1999", estragado') });
    await page.waitForSelector('.modal');
    const txt = await page.locator('.modal').innerText();
    check(txt.includes(await page.evaluate(() => OV.T('save.err.parse'))), 'modal com save.err.parse: ' + txt.replace(/\s+/g, ' ').slice(0, 80));
    await page.keyboard.press('Escape');
    await sleep(150);
    await page.keyboard.press('Escape');
  });

  // ---- iPad: textos de toque, toasts fora do painel no retrato -----------------------------------------------
  const ipad = { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false };
  const t1 = await newPage(ipad);
  await step('iPad: textos de toque na base', async () => {
    const p = t1.page;
    await campaign(p);
    await p.touchscreen.tap(300, 300);
    await p.evaluate(() => OV.BaseUI.open(OV.Game.G, 'b1', 'facilities'));
    await waitTop(p, 'basescape');
    await sleep(400);
    await p.touchscreen.tap(60, 400);
    await sleep(200);
    await p.evaluate(() => OV.BaseUI.refresh());
    const txt = await p.locator('.bsc-info').innerText();
    check(/Toque numa instalação/.test(txt) && !/Clique/.test(txt), 'ajuda da base com «Toque…» (' + txt.replace(/\s+/g, ' ').slice(0, 70) + ')');
    await shot(p, '16_ipad_base_touch');
  });
  const t2 = await newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  await step('iPad retrato: toasts fora do painel lateral', async () => {
    const p = t2.page;
    await campaign(p);
    await p.evaluate(() => OV.Dom.toast('Intercetor-1 regressou à base (Base Lusitânia).', null, 'info'));
    await sleep(350);
    const o = await p.evaluate(() => {
      const t = document.querySelector('#toasts .toast').getBoundingClientRect();
      const s = document.querySelector('.geo-side').getBoundingClientRect();
      return { overlap: Math.max(0, Math.min(t.right, s.right) - Math.max(t.left, s.left)) * Math.max(0, Math.min(t.bottom, s.bottom) - Math.max(t.top, s.top)), t: [t.left, t.right], s: [s.left, s.right] };
    });
    check(o.overlap === 0, 'toast sem sobrepor o painel (toast ' + o.t.map(Math.round) + ', painel ' + o.s.map(Math.round) + ')');
    await shot(p, '17_portrait_toast');
  });
  await t1.ctx.close();
  await t2.ctx.close();
} catch (e) {
  fails.push('exceção: ' + (e && e.message ? e.message.split('\n')[0] : e));
} finally {
  await browser.close();
  server.kill();
}
for (const e of errors) console.log('  ✗ ' + e);
const bad = fails.length + errors.length;
console.log(bad ? '✗ ' + fails.length + ' falha(s), ' + errors.length + ' erro(s) em ' + checks + ' verificações — ' + OUT : '✓ ' + checks + ' verificações sem falhas — capturas em ' + OUT);
process.exit(bad ? 1 : 0);
