/* QA visual dos ícones de itens, sprites no chão e retratos num Chromium real (Playwright), sem servidor
   (file://): abre qa/sheet_items.html em várias vistas e grava capturas; falha em erros de consola/página
   ou se a folha não terminar. Uso: node ovni-1999/qa/sheet_items.mjs [--out <pasta>] [--only icons]
   [--dpr 1|2]. Sem --out grava em $OVNI_QA_OUT, na pasta de QA da sessão (se existir) ou em
   ./qa-out/sheets; a captura principal é sempre <pasta>/items.png. */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, 'sheet_items.html');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const SESSION_QA = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION_QA) ? path.join(SESSION_QA, 'sheets') : path.join(process.cwd(), 'qa-out', 'sheets'));
const OUT = path.resolve(arg('out', DEF_OUT));
const ONLY = arg('only', null);
const DPR = +arg('dpr', 2);

// vistas: [ficheiro, query, dpr]
const SHOTS = [
  ['items.png', 'view=all', DPR],
  ['items_icons.png', 'view=icons&zoom=2', 1],
  ['items_ground.png', 'view=ground&zoom=2', 1],
  ['portraits.png', 'view=portraits&zoom=2&n=24', 1],
  ['portraits_more.png', 'view=portraits&zoom=1&n=48&seed=101', DPR],
];

fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const browser = await chromium.launch();
try {
  for (const [file, query, dpr] of SHOTS) {
    if (ONLY && !(file + '?' + query).includes(ONLY)) continue;
    const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const before = errors.length;
    page.on('pageerror', (e) => errors.push(file + ' pageerror: ' + (e && e.message)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(file + ' console: ' + m.text());
    });
    await page.goto(pathToFileURL(PAGE).href + '?' + query);
    await page.waitForFunction(() => window.__done === true || document.getElementById('err').textContent, null, { timeout: 30000 }).catch(() => errors.push(file + ': a folha não terminou'));
    const err = await page.evaluate(() => document.getElementById('err').textContent);
    if (err) errors.push(file + ': ' + err.trim());
    const info = await page.evaluate(() => window.__info || null);
    const el = await page.$('#sheet');
    await el.screenshot({ path: path.join(OUT, file) });
    console.log((errors.length > before ? '✗ ' : '✓ ') + file + (info ? '  ' + info.drawn + ' células, ' + info.ms + ' ms, ' + info.W + '×' + info.H : ''));
    await ctx.close();
  }
} finally {
  await browser.close();
}
for (const e of errors) console.log('✗ ' + e);
console.log(errors.length ? '✗ ' + errors.length + ' erro(s)' : '✓ sem erros; capturas em ' + OUT);
process.exit(errors.length ? 1 : 0);
