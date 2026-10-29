#!/usr/bin/env node
/* Runner de testes sem dependências.
   node ovni-1999/tools/test.js                 → todos os tests/*.test.js
   node ovni-1999/tools/test.js battle path     → só ficheiros cujo nome contém "battle" ou "path"
   node ovni-1999/tools/test.js --grep "rifle"  → só testes cujo nome contém "rifle"
   Outros argumentos ficam em t.args (ex.: --det, --seeds 20). */
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const args = {};
const filters = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    args[k] = v;
  } else filters.push(a);
}

let OV;
try {
  OV = require('./load')({ finalize: true });
} catch (e) {
  console.error('✗ falha ao carregar/finalizar os dados:\n' + (e.stack || e));
  process.exit(1);
}

const dir = path.join(__dirname, 'tests');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js') && (!filters.length || filters.some((x) => f.includes(x)))).sort();

let pass = 0, fail = 0;
const failures = [];
const deepEq = (a, b) => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) return ArrayBuffer.isView(a) && ArrayBuffer.isView(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEq(a[k], b[k]));
};
const show = (v) => {
  try { return JSON.stringify(v); } catch (e) { return String(v); }
};

const t0 = Date.now();
for (const f of files) {
  const tests = [];
  const t = {
    args,
    test: (name, fn) => tests.push({ name, fn }),
    eq: (a, b, msg) => { if (!deepEq(a, b)) throw new Error((msg ? msg + ': ' : '') + 'esperado ' + show(b) + ', obtido ' + show(a)); },
    ok: (v, msg) => { if (!v) throw new Error(msg || 'esperado verdadeiro'); },
    near: (a, b, eps, msg) => { if (!(Math.abs(a - b) <= eps)) throw new Error((msg ? msg + ': ' : '') + 'esperado ' + b + '±' + eps + ', obtido ' + a); },
    throws: (fn, msg) => { let ok = false; try { fn(); } catch (e) { ok = true; } if (!ok) throw new Error(msg || 'esperava exceção'); },
  };
  try {
    require(path.join(dir, f))(OV, t);
  } catch (e) {
    fail++;
    failures.push(f + ' (carregar): ' + (e.stack || e));
    continue;
  }
  for (const tc of tests) {
    if (args.grep && !tc.name.includes(args.grep)) continue;
    try {
      tc.fn();
      pass++;
    } catch (e) {
      fail++;
      failures.push(f + ' › ' + tc.name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e));
    }
  }
}
if (OV.__missing && OV.__missing.length && args.missing) console.log('ficheiros ainda por criar: ' + OV.__missing.join(', '));
if (OV.T && OV.T.missing.size && args.i18n) console.log('chaves i18n em falta: ' + [...OV.T.missing].join(', '));
for (const m of failures) console.log('✗ ' + m);
console.log((fail ? '✗' : '✓') + ' ' + pass + ' passaram, ' + fail + ' falharam (' + files.length + ' ficheiros, ' + (Date.now() - t0) + ' ms)');
process.exit(fail ? 1 : 0);
