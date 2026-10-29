/* Finalização dos dados: corre os finalizadores registados pelos ficheiros de dados (ids, refs, compilação
   de blocos, validação) e congela as regras. Tem de ser o ÚLTIMO ficheiro de js/data/ no index.html. */
(function (OV) {
  'use strict';

  OV.Data = OV.Data || {};
  OV.Data.finalizers = OV.Data.finalizers || [];
  let done = false;

  // regista um passo: OV.Data.onFinalize('items', fn, order)
  OV.Data.onFinalize = function (name, fn, order) {
    OV.Data.finalizers.push({ name, fn, order: order === undefined ? 50 : order });
  };

  OV.Data.finalize = function () {
    if (done) return OV.Data;
    const list = OV.Data.finalizers.slice().sort((a, b) => a.order - b.order);
    const errors = [];
    for (const f of list) {
      try {
        f.fn(OV.Data);
      } catch (e) {
        errors.push(f.name + ': ' + (e && e.message ? e.message : e));
      }
    }
    if (errors.length) throw new Error('OV.Data.finalize falhou:\n  ' + errors.join('\n  '));
    done = true;
    return OV.Data;
  };
  OV.Data.isFinal = () => done;
})(globalThis.OV || (globalThis.OV = {}));
