import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad/press';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 794, height: 1123 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('file://' + dir + '/ovni-dossie-pdf.html');
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(600);
const over = await p.evaluate(() => [...document.querySelectorAll('.page')].map((pg, i) => {
  const r = pg.getBoundingClientRect();
  let maxB = 0;
  for (const el of pg.querySelectorAll('*')) { if (el.closest('.folio') || el.tagName === 'CANVAS') continue; const q = el.getBoundingClientRect(); if (q.height > 0) maxB = Math.max(maxB, q.bottom - r.top); }
  return { page: i + 1, h: Math.round(r.height), contentBottom: Math.round(maxB) };
}));
console.log(JSON.stringify(over));
const fonts = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
await p.pdf({ path: dir + '/OVNI-Inimigo-Desconhecido-Dossie.pdf', printBackground: true, preferCSSPageSize: true });
console.log('errors', errs);
await b.close();
