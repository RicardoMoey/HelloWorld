/* Ronda de personas 1 — QA do «shell» num Chromium real (Playwright): caminho guiado depois de perder o Skyranger
   (entrega tripulada, «Enviar equipa» com correção a um clique, kit básico), gravação «Antes da missão» e «Repetir a
   missão» depois de uma derrota, foco preso em modais/folhas/diálogos e devolvido, lista de Soldados e grelha ao
   teclado, «Acessibilidade» nas Opções (paleta, movimento, texto), teclas do Geoscape visíveis a 125 %, colocação da
   base e destino ao teclado, Batalha Rápida (duplo clique, Equipar, Enter no relatório), pergunta dos mísseis.
   Capturas a 1440×900, 1024×576 (125 %) e iPad 834×1194 / 1194×834 (toque). Falha em erros de consola/página ou ⟦…⟧.
   Uso: node ovni-1999/qa/persona_r1_shell.mjs [--out <pasta>] [--port <n>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'persona_r1_shell') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r1_shell') : path.join(process.cwd(), 'qa-out', 'persona_r1_shell');
const OUT = path.resolve(arg('--out', DEF_OUT));
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
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) { /* a arrancar */ }
    await sleep(120);
  }
  return false;
}

const port = +arg('--port', 0) || (await freePort());
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/index.html?nosw=1&debug=1`;
const browser = await chromium.launch();

const VIEWS = {
  desk: { viewport: { width: 1440, height: 900 } },
  zoom: { viewport: { width: 1024, height: 576 } },
  padP: { viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  padL: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};

async function openPage(view, tag) {
  const ctx = await browser.newContext(VIEWS[view]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.GeoUI && OV.Campaign && OV.CampaignUI);
  await sleep(300);
  return { ctx, page };
}
const shot = async (page, name) => { await sleep(300); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
const topId = (page) => page.evaluate(() => (OV.Scenes.top() || {}).id);
const noMissing = async (page, where) => {
  const txt = await page.evaluate(() => document.body.innerText);
  const m = txt.match(/⟦[^⟧]*⟧/g);
  check(!m, where + ': chaves i18n em falta ' + (m ? [...new Set(m)].join(', ') : ''));
};
const active = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a ? { tag: a.tagName, cls: String(a.className || ''), text: (a.innerText || a.value || '').slice(0, 40), inModal: !!a.closest('.modal'), inOpts: !!a.closest('.scr-opts'), inSheet: !!a.closest('.bsc-sheet'), inPop: !!a.closest('.geo-pop'), inDlg: !!a.closest('.geo-dlg'), inert: !!a.closest('[inert]') } : null;
});

// cria uma campanha e perde o Skyranger; com recrutas a caminho e um Skyranger novo encomendado
const LOST = (o) => {
  const G = OV.Campaign.newCampaign({ seed: o.seed || 31, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
  const sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'skyranger');
  for (const id of sky.soldiers.slice()) OV.Soldiers.kill(G, id, 'kia', null);
  OV.World.loseCraft(G, sky.id, 'mission');
  G.events.length = 0;
  G.bases[0].stores = Object.assign({}, G.bases[0].stores, { rifle: 3, rifle_clip: 5, pistol: 2, pistol_clip: 4 });
  delete G.bases[0].stores.heavy_cannon;
  OV.BaseSim.buy(G, 'b1', 'skyranger', 1);
  OV.BaseSim.hire(G, 'b1', 'soldier', 5);
  OV.BaseSim.hire(G, 'b1', 'soldier', 5);
  G.ui.geoIntro = true;
  window.__G = G;
  OV.GeoUI.open(G);
  return G.bases[0].deliveries.map((d) => d.kind + ':' + d.n);
};

try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');

  // =============================================================================================================
  log('1. Opções: secção «Acessibilidade», foco preso, paleta/movimento/texto aplicados no <html>');
  {
    const { ctx, page } = await openPage('desk', 'opts');
    await page.keyboard.press('ArrowDown');
    await page.evaluate(() => OV.Scenes.push('options', {}));
    await sleep(400);
    const txt = await page.locator('.scr-opts').innerText();
    check(/Acessibilidade/i.test(txt), 'opções: secção Acessibilidade');
    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
    const a = await active(page);
    check(a && a.inOpts, 'opções: Tab nunca sai do painel (' + JSON.stringify(a) + ')');
    await page.locator('.scr-opts .scr-seg-b', { hasText: 'Daltonismo' }).click();
    await page.locator('.scr-opts .scr-seg-b', { hasText: '130 %' }).click();
    const st = await page.evaluate(() => ({ p: document.documentElement.dataset.palette, s: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(), set: OV.Game.settings }));
    check(st.p === 'cvd' && st.s === '1.3' && st.set.textScale === 1.3 && st.set.palette === 'cvd', 'opções: paleta e escala aplicadas ' + JSON.stringify([st.p, st.s]));
    await shot(page, 'opts-desk-scaled');
    await page.locator('.scr-opts .scr-seg-b', { hasText: '100 %' }).click();
    await page.locator('.scr-opts .scr-seg-b', { hasText: 'Normal' }).first().click();
    await page.locator('.scr-opts .scr-seg-b', { hasText: /^Sim$/ }).click();
    check(await page.evaluate(() => document.documentElement.dataset.motion === 'reduce' && OV.Game.reduceMotion()), 'opções: reduzir movimento');
    await page.locator('.scr-opts .scr-seg-b', { hasText: 'Sistema' }).click();
    await noMissing(page, 'opções');
    await shot(page, 'opts-desk');
    await page.keyboard.press('Escape');
    await sleep(300);
    const back = await active(page);
    check(back && /scr-mi/.test(back.cls), 'opções: ao fechar o foco volta ao menu (' + JSON.stringify(back) + ')');
    // modal: foco preso, Enter num botão ativa esse botão, foco devolvido
    const r = await page.evaluate(async () => {
      const b = document.querySelector('.scr-mi');
      b.focus();
      const p = OV.Dom.modal({ title: 'Teste', body: 'x', buttons: [{ label: 'Cancelar', value: 'no' }, { label: 'Confirmar', value: 'yes', kind: 'primary' }] });
      window.__mp = p;
      return !!document.querySelector('#hud').inert;
    });
    check(r, 'modal: o resto da página fica inerte');
    for (let i = 0; i < 7; i++) await page.keyboard.press('Tab');
    check((await active(page)).inModal, 'modal: Tab fica no modal');
    await page.evaluate(() => { [...document.querySelectorAll('#modals .btn')].find((b) => b.textContent === 'Cancelar').focus(); });
    await page.keyboard.press('Enter');
    const val = await page.evaluate(() => window.__mp);
    check(val === 'no', 'modal: Enter em «Cancelar» cancela (valor ' + val + ')');
    const after = await active(page);
    check(after && /scr-mi/.test(after.cls) && !(await page.evaluate(() => document.querySelector('#hud').inert)), 'modal: foco devolvido e página ativa');
    await ctx.close();
  }

  // =============================================================================================================
  log('2. Skyranger perdido: entrega tripulada e equipada, aviso de quem ficou sem arma, kit básico');
  for (const view of ['desk', 'zoom', 'padL']) {
    const { ctx, page } = await openPage(view, 'lost-' + view);
    const dl = await page.evaluate(LOST, {});
    check(dl.length === 3, view + ': encomendas (Skyranger + 2×5 soldados) ' + dl.join(','));
    // avança o relógio até à primeira janela (soldados chegam às 48 h; o Skyranger às 72 h)
    await page.evaluate(() => {
      const G = window.__G;
      for (let i = 0; i < 400 && !G.bases[0].crafts.some((id) => G.crafts[id].type === 'skyranger'); i++) {
        OV.World.step(G, 720);
        const evs = G.events.splice(0);
        if (evs.length) OV.GeoUI.current && OV.Game.G === G && (G.events.push(...evs));
        if (G.events.length) {
          const sc = OV.Scenes.stack.find((x) => x.id === 'geoscape');
          if (sc) sc.onInput({ kind: 'noop' });
        }
        if (G.events.some((e) => e.t === 'deliveryArrived' && e.kind === 'craft')) break;
      }
    });
    await sleep(900);
    let st = await page.evaluate(() => OV.GeoUI.current());
    // as janelas de entrega aparecem (soldados, depois a nave)
    const texts = [];
    for (let k = 0; k < 6 && st && (st.popup || st.queue.length); k++) {
      if (st.popup) {
        const t = await page.locator('.geo-pop').last().innerText();
        texts.push(t);
        if (k === 0 || /embarc/.test(t)) await shot(page, 'lost-' + view + '-popup' + k);
        if (/Kit básico/i.test(t) && view === 'desk') {
          await page.locator('.geo-pop .btn', { hasText: /Kit básico/i }).click();
          await sleep(400);
          check(await page.locator('#modals .modal').isVisible(), 'kit básico: diálogo com o custo');
          await noMissing(page, 'kit básico');
          await shot(page, 'lost-desk-kit');
          await page.keyboard.press('Enter');
          await sleep(300);
          const d = await page.evaluate(() => window.__G.bases[0].deliveries.filter((x) => x.kind === 'item').map((x) => x.itemId + ':' + x.n));
          check(d.some((x) => /^rifle:/.test(x)), 'kit básico: espingardas encomendadas ' + d.join(','));
        } else {
          await page.keyboard.press('Escape');
        }
        await sleep(350);
      } else await sleep(300);
      st = await page.evaluate(() => OV.GeoUI.current());
    }
    const all = texts.join('\n');
    check(/Chegaram 10 soldados/.test(all), view + ': entrega somada («Chegaram 10 soldados») ');
    check(/embarcaram/.test(all) && /armas do armazém/.test(all), view + ': soldados embarcados e equipados no aviso');
    const crew = await page.evaluate(() => {
      const G = window.__G;
      const c = G.bases[0].crafts.map((id) => G.crafts[id]).find((x) => x.type === 'skyranger');
      return c ? { n: c.soldiers.length, unarmed: OV.CampaignUI.unarmedAboard(G, c.id).length } : null;
    });
    check(crew && crew.n === 10, view + ': o Skyranger novo parte tripulado (' + JSON.stringify(crew) + ')');
    await noMissing(page, 'lost-' + view);
    // «Enviar equipa» para um OVNI despenhado: aviso de quem vai sem arma e correção
    await page.evaluate(() => {
      const G = window.__G;
      G.ufos.push({ id: 'u90', type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: -4, lat: 40.3, dest: null, alt: 0, speed: 0, status: 'crashed', dmg: 30, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 86400, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      OV.GeoUI.select({ kind: 'ufo', id: 'u90' });
    });
    await sleep(300);
    await page.keyboard.press('e');
    await sleep(500);
    check(await page.locator('.geo-dlg').isVisible(), view + ': diálogo «Enviar equipa»');
    const fix = await page.locator('.geo-fix').count();
    check(crew.unarmed === 0 || fix > 0, view + ': transporte com soldados sem arma mostra a correção');
    await shot(page, 'lost-' + view + '-send');
    if (view === 'desk') {
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
      const a = await active(page);
      check(a && a.inDlg && !a.inert, 'enviar equipa: Tab fica no diálogo (' + JSON.stringify(a) + ')');
    }
    await page.keyboard.press('Escape');
    await sleep(200);
    await ctx.close();
  }

  // =============================================================================================================
  log('3. «Enviar equipa» com um transporte vazio: embarcar e equipar a um clique');
  {
    const { ctx, page } = await openPage('desk', 'send');
    await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 5, difficulty: 1, baseLonLat: { lon: -9.14, lat: 38.72 } });
      const sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'skyranger');
      for (const id of sky.soldiers.slice()) OV.BaseSim.assignSoldier(G, id, null);
      G.ui.geoIntro = true;
      G.ufos.push({ id: 'u91', type: 'medium_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: -3, lat: 41, dest: null, alt: 0, speed: 0, status: 'crashed', dmg: 60, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 86400, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      window.__G = G;
      OV.GeoUI.open(G);
    });
    await sleep(700);
    await page.evaluate(() => OV.GeoUI.select({ kind: 'ufo', id: 'u91' }));
    await sleep(200);
    await page.keyboard.press('e');
    await sleep(500);
    const t = await page.locator('.geo-fix').first().innerText();
    check(/aptos na base/.test(t), 'enviar equipa: explica porque não há tropas («' + t.slice(0, 60) + '»)');
    await shot(page, 'send-empty');
    await page.locator('.geo-fix .btn', { hasText: /Embarcar/ }).click();
    await sleep(500);
    const n = await page.evaluate(() => { const G = window.__G; const c = Object.keys(G.crafts).map((id) => G.crafts[id]).find((x) => x.type === 'skyranger'); return c.soldiers.length; });
    check(n === 10, 'enviar equipa: «Embarcar e equipar» embarcou ' + n);
    check(await page.locator('.geo-row.transport:not(:disabled)').count() > 0, 'enviar equipa: o Skyranger já pode partir');
    await shot(page, 'send-fixed');
    await ctx.close();
  }

  // =============================================================================================================
  log('4. Briefing → derrota → «Repetir a missão» (gravação «Antes da missão»); auto2 e antes da missão no diálogo');
  {
    const { ctx, page } = await openPage('desk', 'retry');
    await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 77, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
      G.ui.geoIntro = true;
      G.ufos.push({ id: 'u92', type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: -8.5, lat: 39.2, dest: null, alt: 0, speed: 0, status: 'crashed', dmg: 30, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 86400, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      const sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'skyranger');
      OV.World.launch(G, sky.id, { kind: 'ufo', id: 'u92' });
      for (let i = 0; i < 200 && sky.status !== 'patrol'; i++) OV.World.step(G, 60);
      G.events.length = 0;
      OV.CampaignUI.autosave(G, { silent: true });
      OV.CampaignUI.autosave(G, { silent: true });
      window.__G = G;
      window.__sky = sky.id;
      OV.GeoUI.open(G);
      OV.CampaignUI.launchMission(G, { kind: 'ufo', id: 'u92' }, sky.id);
    });
    await sleep(800);
    check((await topId(page)) === 'cbriefing', 'briefing aberto');
    const crew = await page.locator('.cp-brief .scr-intel dd').nth(1).innerText();
    check(!/–/.test(crew) || /\d–\d/.test(crew), 'briefing: efetivo estimado ' + crew);
    check(await page.evaluate(() => !!localStorage.getItem(OV.Save.KEY('preMission'))), 'gravação «Antes da missão» feita ao abrir o briefing');
    await shot(page, 'retry-briefing');
    // começar e perder: todos os soldados X-COM mortos
    await sleep(500);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'battlescape', null, { timeout: 20000 });
    await sleep(800);
    await page.evaluate(() => {
      const B = OV.Game.B, G = window.__G;
      const al = B.units.find((u) => u.side === 'alien');
      for (const u of B.units) if (u.side === 'xcom') { u.status = 'dead'; u.killedBy = al ? al.id : null; }
      OV.CampaignUI.afterBattle(G, B, { outcome: 'loss' });
    });
    await sleep(900);
    check((await topId(page)) === 'cdebrief', 'relatório da campanha');
    const deb = await page.locator('.cp-deb').innerText();
    check(/Dica/.test(deb), 'relatório: dica da causa principal');
    check(await page.locator('.cp-deb .btn', { hasText: /Repetir a missão/ }).isVisible(), 'relatório: «Repetir a missão» em Recruta');
    await noMissing(page, 'relatório derrota');
    await shot(page, 'retry-debrief');
    await page.keyboard.press('r');
    await sleep(1200);
    const top = await topId(page);
    check(top === 'cbriefing', '«Repetir a missão» volta ao briefing (topo: ' + top + ')');
    const soldiers = await page.evaluate(() => Object.keys(OV.Game.G.soldiers).length);
    check(soldiers >= 10, 'a gravação «Antes da missão» tem a equipa viva (' + soldiers + ')');
    await page.keyboard.press('Escape');
    await sleep(500);
    await page.evaluate(() => OV.CampaignUI.loadDialog());
    await sleep(500);
    const sl = await page.locator('.cp-sl').innerText();
    check(/automática \(anterior\)/i.test(sl) && /antes da missão/i.test(sl), 'gravações: «Automática (anterior)» e «Antes da missão» listadas');
    await shot(page, 'retry-saves');
    await ctx.close();
  }

  // =============================================================================================================
  log('5. Base: Soldados ao teclado, grelha ao teclado, folha de investigação com o foco preso, foco após Contratar');
  {
    const { ctx, page } = await openPage('desk', 'base');
    await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 12, difficulty: 1, baseLonLat: { lon: -9.14, lat: 38.72 } });
      G.ui.geoIntro = true;
      window.__G = G;
      OV.GeoUI.open(G);
      OV.BaseUI.open(G, 'b1', 'soldiers');
    });
    await sleep(700);
    const s0 = await page.evaluate(() => OV.BaseUI.debug.state().solSel);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await sleep(200);
    const s1 = await page.evaluate(() => OV.BaseUI.debug.state().solSel);
    const a1 = await active(page);
    check(s1 && s1 !== s0 && a1 && a1.tag === 'TR', 'soldados: ↓ escolhe o seguinte e a linha fica com o foco (' + s0 + '→' + s1 + ')');
    await page.keyboard.press('Enter');
    await sleep(150);
    check((await active(page)).tag === 'INPUT', 'soldados: Enter vai para a ficha (nome)');
    await page.keyboard.press('Escape');
    await shot(page, 'base-soldiers');
    // instalações: cursor de teclado
    await page.keyboard.press('1');
    await sleep(200);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await sleep(200);
    const sel = await page.evaluate(() => OV.BaseUI.debug.state());
    check(sel.kcur && sel.sel, 'instalações: setas + Enter escolhem uma instalação ' + JSON.stringify([sel.kcur, sel.sel]));
    await shot(page, 'base-facilities-kbd');
    // investigação: folha com foco preso (Enter de novo larga a instalação; Esc sairia da base)
    await page.keyboard.press('Enter');
    await page.keyboard.press('2');
    await sleep(200);
    await page.keyboard.press('n');
    await sleep(400);
    for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
    const a2 = await active(page);
    check(a2 && a2.inSheet, 'investigação: Tab fica na folha «Novo projeto» (' + JSON.stringify(a2) + ')');
    const lbl = await page.evaluate(() => [...document.querySelectorAll('.bsc-sheet [data-start]')].map((b) => b.getAttribute('aria-label')).slice(0, 3));
    check(lbl.length && lbl.every((x) => /^Iniciar: /.test(x || '')), 'investigação: «Iniciar: <projeto>» como nome acessível ' + lbl.join(' | '));
    await page.keyboard.press('Escape');
    await sleep(200);
    // pessoal: Contratar com Enter mantém o foco
    await page.keyboard.press('4');
    await sleep(300);
    await page.evaluate(() => document.querySelector('[data-hire="scientist"][data-n="10"]').focus());
    await page.keyboard.press('Enter');
    await sleep(300);
    const a3 = await active(page);
    check(a3 && a3.tag === 'BUTTON' && /CONTRATAR|Contratar/.test(a3.text), 'pessoal: o foco fica em «Contratar» (' + JSON.stringify(a3) + ')');
    await page.keyboard.press('6');
    await sleep(300);
    await shot(page, 'base-crafts');
    await noMissing(page, 'base');
    await ctx.close();
  }

  // =============================================================================================================
  log('6. Geoscape a 125 %: teclas visíveis; T percorre alvos; destino e base ao teclado');
  for (const view of ['zoom', 'desk']) {
    const { ctx, page } = await openPage(view, 'geo-' + view);
    await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 8, difficulty: 1, baseLonLat: { lon: -9.14, lat: 38.72 } });
      G.ui.geoIntro = true;
      window.__G = G;
      OV.GeoUI.open(G);
    });
    await sleep(800);
    const kb = await page.evaluate(() => [...document.querySelectorAll('.geo-sp kbd, .geo-acts .btn kbd')].map((k) => getComputedStyle(k).display));
    check(kb.length >= 10 && kb.every((d) => d !== 'none'), view + ': teclas visíveis no painel (' + kb.join(',') + ')');
    await shot(page, 'geo-' + view);
    if (view === 'zoom') {
      // destino ao teclado: I → nave → G → setas → Enter
      await page.keyboard.press('i');
      await sleep(400);
      const rows = await page.locator('.geo-row:not(:disabled)').count();
      check(rows > 0, 'interceção: naves');
      await page.locator('.geo-row:not(:disabled)').first().click();
      await sleep(300);
      await page.keyboard.press('g');
      await sleep(300);
      await page.keyboard.down('ArrowLeft'); await sleep(300); await page.keyboard.up('ArrowLeft');
      await sleep(200);
      await shot(page, 'geo-zoom-aim');
      await page.keyboard.press('Enter');
      await sleep(400);
      const air = await page.evaluate(() => Object.keys(window.__G.crafts).map((id) => window.__G.crafts[id]).some((c) => c.status === 'out' && c.dest && c.dest.kind === 'point'));
      check(air, 'modo de destino: Enter envia a nave ao ponto na mira');
    }
    await noMissing(page, 'geo-' + view);
    await ctx.close();
  }
  {
    const { ctx, page } = await openPage('desk', 'place');
    await page.evaluate(() => OV.CampaignUI.newGame());
    await sleep(400);
    await page.keyboard.press('3');
    await sleep(150);
    const fa = await active(page);
    check(fa && /cp-diff/.test(fa.cls) && /d2/.test(fa.cls), 'dificuldade: o foco acompanha a escolha (tecla 3)');
    await page.keyboard.press('Enter');
    await sleep(900);
    // roda para norte (Península Ibérica) e escolhe o ponto na mira com Espaço
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowUp'); await sleep(120); }
    await sleep(500);
    const aim = await page.evaluate(() => {
      const d = OV.CampaignUI.debug.newgame();
      const p = OV.GlobeRender.pick(d.view, Number.isFinite(d.view.cx) ? d.view.cx : d.view.w / 2, Number.isFinite(d.view.cy) ? d.view.cy : d.view.h / 2);
      return p ? { lon: +p.lon.toFixed(3), lat: +p.lat.toFixed(3), land: OV.GMath.isLand(p.lon, p.lat) } : null;
    });
    await page.keyboard.press(' ');
    await sleep(300);
    const after = await page.evaluate(() => OV.CampaignUI.debug.newgame());
    check(aim && (!aim.land || (Math.abs(after.chosen.lon - aim.lon) < 0.6 && Math.abs(after.chosen.lat - aim.lat) < 0.6)), 'nova campanha: setas + Espaço escolhem o ponto na mira ' + JSON.stringify([aim, after.chosen]));
    await shot(page, 'place-kbd');
    // Enter no nome só fecha o campo
    await page.locator('.cp-name').focus();
    await page.keyboard.press('Enter');
    await sleep(300);
    check((await topId(page)) === 'newgame', 'nova campanha: Enter no nome não funda a base');
    await ctx.close();
  }

  // =============================================================================================================
  log('7. Batalha Rápida: duplo clique não salta o briefing; Equipar; arma pesada pela Força; Enter no relatório');
  for (const view of ['desk', 'padP']) {
    const { ctx, page } = await openPage(view, 'quick-' + view);
    await page.evaluate(() => OV.Scenes.push('quickbattle', {}));
    await sleep(500);
    const start = page.locator('.scr-qb .btn.primary');
    await start.dblclick();
    await sleep(700);
    check((await topId(page)) === 'briefing', view + ': duplo clique em «Começar» para no briefing');
    await noMissing(page, 'briefing rápido');
    await shot(page, 'quick-' + view + '-briefing');
    if (view === 'desk') {
      await page.keyboard.press('e');
      await sleep(700);
      check((await topId(page)) === 'qequip', 'briefing rápido: E abre «Equipar»');
      await shot(page, 'quick-desk-equip');
      await page.keyboard.press('Escape');
      await sleep(400);
      check((await topId(page)) === 'briefing', '«Equipar» volta ao briefing');
      // relatório: Enter com a lista em foco continua
      await page.evaluate(() => {
        const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'crash', ufo: 'medium_scout', month: 1, seed: 7, squad: 6, time: 'day' });
        const B = OV.Battle.create(mission);
        const xs = B.units.filter((u) => u.side === 'xcom');
        xs[0].status = 'dead'; xs[0].killedBy = xs[1].id;
        xs[2].status = 'dead'; xs[2].killedBy = xs[1].id;
        for (const u of xs) u.status = 'dead';
        OV.Scenes.set('menu');
        OV.Scenes.push('debrief', { B, mission, meta, quick: meta.quick });
      });
      await sleep(600);
      check(/fogo amigo/.test(await page.locator('.scr-debrief').innerText()), 'relatório rápido: mortos por fogo amigo');
      await shot(page, 'quick-desk-debrief');
      await page.evaluate(() => { const b = document.querySelector('.scr-deb-body'); b.tabIndex = 0; b.focus(); });
      await page.keyboard.press('Enter');
      await sleep(400);
      check((await topId(page)) === 'menu', 'relatório rápido: Enter com a lista em foco continua');
    }
    await ctx.close();
  }

  // =============================================================================================================
  log('8. Interceção: pergunta dos mísseis contra um OVNI muito pequeno');
  for (const view of ['desk', 'padL']) {
    const { ctx, page } = await openPage(view, 'df-' + view);
    const ok = await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 21, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
      G.ui.geoIntro = true;
      G.ufos.push({ id: 'u93', type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: -8, lat: 40, dest: { lon: 0, lat: 45 }, alt: 2, speed: 2200, status: 'flying', dmg: 0, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      const ic = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'interceptor');
      window.__G = G;
      OV.GeoUI.open(G);
      const d = OV.Dogfight.create(G, ic.id, 'u93');
      window.__d = d;
      G.events.length = 0;
      return OV.DogfightUI.open(G, d.id);
    });
    await sleep(800);
    check(ok && (await page.locator('.df-ask').isVisible()), view + ': pergunta «Desligar os mísseis?» visível');
    check(await page.evaluate(() => OV.DogfightUI.isPaused()), view + ': combate em pausa enquanto pergunta');
    await shot(page, 'df-' + view + '-ask');
    if (view === 'desk') {
      await page.keyboard.press('q');
      await sleep(300);
      const st = await page.evaluate(() => ({ paused: OV.DogfightUI.isPaused(), on: window.__d.weapons.map((w) => w.enabled), ask: document.querySelector('.df-ask').classList.contains('hidden') }));
      check(!st.paused && st.ask && st.on[0] === false && st.on[1] === true, 'Q desliga os mísseis (o canhão fica) e retoma ' + JSON.stringify(st));
    }
    await noMissing(page, 'df-' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('9. Ufopédia: pesquisa sem resultados volta ao artigo de antes');
  {
    const { ctx, page } = await openPage('desk', 'up');
    await page.evaluate(() => OV.Ufopaedia.open(null));
    await sleep(500);
    const t0 = await page.locator('.up-title').innerText();
    await page.locator('.up-search').fill('s');
    await sleep(150);
    await page.locator('.up-search').fill('zzzq');
    await sleep(200);
    const t1 = await page.locator('.up-title').innerText();
    check(t1 === t0, 'ufopédia: sem resultados mostra o artigo de antes (' + t0 + ' / ' + t1 + ')');
    await ctx.close();
  }

  // =============================================================================================================
  log('10. Capturas de ecrãs alterados em iPad (retrato e paisagem)');
  for (const view of ['padP', 'padL', 'zoom']) {
    const { ctx, page } = await openPage(view, 'shots-' + view);
    await page.evaluate(() => OV.Scenes.push('options', {}));
    await sleep(400);
    await shot(page, 'shots-' + view + '-options');
    await page.evaluate(() => OV.Scenes.pop());
    await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 44, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
      window.__G = G;
      OV.GeoUI.open(G);
    });
    await sleep(900);
    await noMissing(page, 'intro ' + view);
    await shot(page, 'shots-' + view + '-geo-intro');
    const intro = await page.locator('.geo-pop').innerText().catch(() => '');
    if (view !== 'zoom') check(!/Teclas 1–6/.test(intro), view + ': a introdução no toque não fala de teclas');
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.evaluate(() => OV.BaseUI.open(window.__G, 'b1', 'crafts'));
    await sleep(600);
    await shot(page, 'shots-' + view + '-base-crafts');
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
  console.log(e);
} finally {
  await browser.close();
  server.kill();
}
for (const e of errors) fails.push(e);
console.log((fails.length ? '✗ ' : '✓ ') + (checks - fails.length + errors.length) + '/' + checks + ' verificações; capturas em ' + OUT);
for (const f of fails) console.log('  - ' + f);
process.exit(fails.length ? 1 : 0);
