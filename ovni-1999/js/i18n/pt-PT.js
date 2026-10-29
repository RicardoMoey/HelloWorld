/* i18n: tabela de textos pt-PT e função de tradução. As áreas acrescentam chaves nos seus ficheiros. */
(function (OV) {
  'use strict';

  OV.STR = OV.STR || {};
  const missing = new Set();

  // OV.T('chave', {param}) → texto com {param} substituído; chave em falta → ⟦chave⟧
  function T(key, params) {
    let s = OV.STR[key];
    if (s === undefined) {
      missing.add(key);
      return '⟦' + key + '⟧';
    }
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
    return s;
  }
  // plural pt-PT: 1 → .one, resto → .other; {n} disponível nos params
  function Tn(key, n, params) {
    const p = Object.assign({ n }, params || {});
    return T(key + (n === 1 ? '.one' : '.other'), p);
  }
  T.missing = missing;
  T.has = (key) => OV.STR[key] !== undefined;

  Object.assign(OV.STR, {
    'game.title': 'OVNI: Inimigo Desconhecido',
    'game.subtitle': 'Defesa da Terra — 1999',
    'common.ok': 'OK',
    'common.cancel': 'Cancelar',
    'common.close': 'Fechar',
    'common.yes': 'Sim',
    'common.no': 'Não',
    'common.back': 'Voltar',
    'common.confirm': 'Confirmar',
    'common.loading': 'A carregar…',
    'common.none': 'Nenhum',
    'common.days.one': '{n} dia',
    'common.days.other': '{n} dias',
    'common.hours.one': '{n} hora',
    'common.hours.other': '{n} horas',
    'diff.0': 'Recruta',
    'diff.1': 'Veterano',
    'diff.2': 'Super-humano',
  });

  OV.T = T;
  OV.Tn = Tn;
})(globalThis.OV || (globalThis.OV = {}));
