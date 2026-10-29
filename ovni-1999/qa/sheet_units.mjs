/* QA visual dos sprites de unidades num Chromium real (Playwright), sem servidor (file://):
   abre qa/sheet_units.html em várias vistas e grava capturas de ecrã; falha em erros de consola/página
   ou se a folha não terminar. Uso: node ovni-1999/qa/sheet_units.mjs [--out <pasta>] [--only overview]
   [--dpr 1|2] [--bounds]. Sem --out grava em $OVNI_QA_OUT, na pasta de QA da sessão (se existir) ou em
   ./qa-out/sheets; a captura principal é sempre <pasta>/units.png. */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, 'sheet_units.html');
const KEYS = ['soldier', 'sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'cyberdisc', 'sectopod', 'reaper', 'chryssalid', 'zombie', 'civilian_m', 'civilian_f'];

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const SESSION_QA = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION_QA) ? path.join(SESSION_QA, 'sheets') : path.join(process.cwd(), 'qa-out', 'sheets'));
const OUT = path.resolve(arg('out', DEF_OUT));
const ONLY = arg('only', null);
const DPR = +arg('dpr', 1);
const BOUNDS = argv.includes('--bounds') ? '&bounds=1' : '';

// vistas: [ficheiro, query]
const SHOTS = [['units.png', 'view=overview&zoom=1'], ['units_variants.png', 'view=variants&zoom=2'], ['units_all.png', 'view=all&zoom=1']];
for (const k of KEYS) SHOTS.push(['units_' + k + '.png', 'view=poses&zoom=2&key=' + k]);
SHOTS.push(['units_soldier_power.png', 'view=poses&zoom=2&key=soldier&armour=power_suit']);
SHOTS.push(['units_soldier_flying.png', 'view=poses&zoom=2&key=soldier&armour=flying_suit']);

fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ deviceScaleFactor: DPR, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  for (const [file, query] of SHOTS) {
    if (ONLY && !(file + '?' + query).includes(ONLY)) continue;
    const before = errors.length;
    await page.goto(pathToFileURL(PAGE).href + '?' + query + BOUNDS);
    await page.waitForFunction(() => window.__done === true || document.getElementById('err').textContent, null, { timeout: 30000 }).catch(() => errors.push(file + ': a folha não terminou'));
    const info = await page.evaluate(() => window.__info || null);
    const el = await page.$('#sheet');
    await el.screenshot({ path: path.join(OUT, file) });
    console.log((errors.length > before ? '✗ ' : '✓ ') + file + (info ? '  ' + info.drawn + ' células, ' + info.ms + ' ms, ' + info.W + '×' + info.H : ''));
  }
} finally {
  await browser.close();
}
for (const e of errors) console.log('✗ ' + e);
console.log(errors.length ? '✗ ' + errors.length + ' erro(s)' : '✓ sem erros; capturas em ' + OUT);
process.exit(errors.length ? 1 : 0);
