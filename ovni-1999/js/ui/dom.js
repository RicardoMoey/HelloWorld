/* Utilitários DOM: criação de elementos, toasts, modais com Promise, tooltips, barras */
(function (OV) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // el('div', {class:'x', onclick: fn, text:'...', html:'...', dataset:{a:1}, style:{...}}, ...filhos)
  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (v === true) n.setAttribute(k, '');
        else n.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c === undefined || c === null || c === false) continue;
      n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  // ---- toasts ------------------------------------------------------------------------------
  // toast('chave.i18n', {params}, 'info'|'warn'|'alert'|'good')  ou  toast('texto literal')
  function toast(textOrKey, params, kind) {
    const box = $('toasts');
    if (!box) return;
    const text = OV.T && OV.T.has && OV.T.has(textOrKey) ? OV.T(textOrKey, params) : textOrKey;
    const d = el('div', { class: 'toast ' + (kind || 'info'), text });
    box.appendChild(d);
    while (box.children.length > 5) box.removeChild(box.firstChild);
    setTimeout(() => d.classList.add('fade'), 3400);
    setTimeout(() => d.remove(), 4100);
  }

  // ---- modais -------------------------------------------------------------------------------
  // modal({title, body: Node|string, buttons:[{label, value, kind:'primary'|'danger'}], dismissible, wide})
  // → Promise(valor do botão; null se fechado com Esc/fundo)
  function modal(spec) {
    return new Promise((resolve) => {
      const host = $('modals');
      const close = (v) => {
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        resolve(v);
      };
      const onKey = (e) => {
        // repetição automática de uma tecla premida antes do modal abrir (Enter longo) nunca o confirma
        if (e.repeat && (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); return; }
        if (e.key === 'Escape' && spec.dismissible !== false) { e.preventDefault(); e.stopPropagation(); close(null); }
        if (e.key === 'Enter') {
          const prim = (spec.buttons || []).find((b) => b.kind === 'primary');
          if (prim) { e.preventDefault(); e.stopPropagation(); close(prim.value); }
        }
      };
      const body = typeof spec.body === 'string' ? el('div', { class: 'modal-text', html: spec.body }) : spec.body;
      const btns = (spec.buttons || [{ label: OV.T('common.ok'), value: true, kind: 'primary' }]).map((b) =>
        el('button', { class: 'btn ' + (b.kind || ''), onclick: () => close(b.value) }, b.label));
      const box = el('div', { class: 'modal' + (spec.wide ? ' wide' : '') + (spec.cls ? ' ' + spec.cls : ''), role: 'dialog', 'aria-modal': 'true' },
        spec.title ? el('h2', { class: 'modal-title', text: spec.title }) : null,
        body,
        el('div', { class: 'modal-actions' }, btns));
      const back = el('div', { class: 'modal-back', onclick: (e) => { if (e.target === back && spec.dismissible !== false) close(null); } }, box);
      host.appendChild(back);
      document.addEventListener('keydown', onKey, true);
      const prim = box.querySelector('.btn.primary') || box.querySelector('.btn');
      if (prim) prim.focus();
    });
  }
  const anyModalOpen = () => !!($('modals') && $('modals').children.length);

  // ---- tooltip ------------------------------------------------------------------------------
  const noHover = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: none)').matches;
  function tooltip(node, content) {
    node.addEventListener('mouseenter', () => {
      if (noHover()) return;
      const t = $('tooltip');
      const html = typeof content === 'function' ? content() : content;
      if (!html) return;
      t.innerHTML = html;
      t.classList.remove('hidden');
      const r = node.getBoundingClientRect();
      const tw = t.offsetWidth, th = t.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
      if (y < 4) y = r.bottom + 8;
      x = Math.max(4, Math.min(window.innerWidth - tw - 4, x));
      t.style.left = x + 'px';
      t.style.top = y + 'px';
    });
    node.addEventListener('mouseleave', hideTooltip);
    node.addEventListener('pointerdown', hideTooltip);
  }
  function hideTooltip() {
    const t = $('tooltip');
    if (t) t.classList.add('hidden');
  }

  // barra horizontal com valor (UT, saúde…): bar(valor, máximo, 'tu'|'hp'|'en'|'mo', extra)
  function bar(v, max, kind, label) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
    return el('div', { class: 'bar bar-' + (kind || 'tu'), title: label || '' },
      el('i', { style: { width: pct.toFixed(1) + '%' } }),
      el('span', { text: label !== undefined ? label : v + '/' + max }));
  }

  // download de um ficheiro de texto (exportar gravação)
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // abrir ficheiro → Promise<string>
  function pickFile(accept) {
    return new Promise((resolve) => {
      const inp = el('input', { type: 'file', accept: accept || '.json,application/json', style: { display: 'none' } });
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        if (!f) return resolve(null);
        const rd = new FileReader();
        rd.onload = () => resolve(String(rd.result));
        rd.onerror = () => resolve(null);
        rd.readAsText(f);
      });
      document.body.appendChild(inp);
      inp.click();
      setTimeout(() => inp.remove(), 60000);
    });
  }

  OV.Dom = { $, el, clear, toast, modal, anyModalOpen, tooltip, hideTooltip, bar, download, pickFile };
})(globalThis.OV || (globalThis.OV = {}));
