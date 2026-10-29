/* Carregador Node: lê a ordem dos <script> em index.html e carrega as camadas sem DOM
   (core, i18n, data, sim) + gfx puros (color, iso). Uso: const OV = require('./load')({finalize:true}) */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const NODE_LAYERS = ['js/core/', 'js/i18n/', 'js/data/', 'js/sim/'];
const PURE_GFX = ['js/gfx/color.js', 'js/gfx/iso.js'];

function scriptList() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = [];
  const re = /<script\s+src="([^"?]+)(?:\?[^"]*)?"\s*><\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function nodeFiles(opts) {
  opts = opts || {};
  return scriptList().filter((f) => NODE_LAYERS.some((p) => f.startsWith(p)) || PURE_GFX.includes(f) || (opts.extra || []).includes(f));
}

let loaded = null;
module.exports = function load(opts) {
  opts = opts || {};
  if (loaded) return loaded;
  globalThis.OV = {};
  const missing = [];
  const loadErrors = [];
  for (const f of nodeFiles(opts)) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) {
      missing.push(f);
      continue;
    }
    try {
      vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: abs });
    } catch (e) {
      // um ficheiro partido não impede o carregamento dos restantes (trabalho em paralelo)
      loadErrors.push(f + ': ' + (e && e.message ? e.message : e));
      if (opts.strict) throw e;
    }
  }
  const OV = globalThis.OV;
  OV.__missing = missing;
  OV.__loadErrors = loadErrors;
  if (opts.finalize !== false && OV.Data && OV.Data.finalize) {
    try {
      OV.Data.finalize();
    } catch (e) {
      OV.__finalizeError = e;
      if (opts.strict) throw e;
    }
  }
  loaded = OV;
  return OV;
};
module.exports.ROOT = ROOT;
module.exports.scriptList = scriptList;
module.exports.nodeFiles = nodeFiles;
