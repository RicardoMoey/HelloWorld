/* Utilitários DOM: criação de elementos, toasts, modais com Promise (foco preso e devolvido), tooltips, barras.
   OV.Dom = { $, el, clear, toast, modal, anyModalOpen, tooltip (também toque longo no iPad), hideTooltip, hideLongPress, bar,
              download, pickFile,
              trapFocus(caixa, {keep, returnTo}) → release(restore?) ; trapOpen() ; focusKey(nó) ; refocus(chave, dentro?) ;
              focusables(caixa) } */
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

  // ---- foco preso num diálogo ------------------------------------------------------------------------------
  // trapFocus(caixa, {keep:[nós], returnTo}) → release(): o resto da página fica inerte (sem foco nem cliques, fora do
  // que está em keep), Tab/⇧Tab dão a volta dentro da caixa e, ao libertar, o foco volta a quem abriu o diálogo.
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const traps = [];
  function focusables(box) {
    return [...box.querySelectorAll(FOCUSABLE)].filter((n) => !n.closest('[inert]') && !n.closest('.hidden') && n.offsetParent !== null);
  }
  // chave estável de um elemento (para o reencontrar depois de um redesenho)
  function focusKey(n) {
    if (!n || n === document.body || !n.getAttribute) return null;
    const ds = n.dataset ? Object.keys(n.dataset) : [];
    if (ds.length) return n.tagName.toLowerCase() + ds.map((k) => '[data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + '="' + String(n.dataset[k]).replace(/"/g, '\\"') + '"]').join('');
    if (n.id) return '#' + n.id;
    const lbl = n.getAttribute('aria-label');
    if (lbl) return n.tagName.toLowerCase() + '[aria-label="' + lbl.replace(/"/g, '\\"') + '"]';
    return null;
  }
  function refocus(key, within) {
    if (!key) return false;
    let n = null;
    try { n = (within || document).querySelector(key); } catch (e) { n = null; }
    if (!n || n.closest('[inert]') || n.disabled) return false;
    n.focus({ preventScroll: true });
    return document.activeElement === n;
  }
  function trapFocus(box, opts) {
    const o = opts || {};
    const back = o.returnTo !== undefined ? o.returnTo : document.activeElement;
    const backKey = focusKey(back);
    const keep = new Set((o.keep || []).filter(Boolean));
    // #modals nunca fica inerte: um modal aberto a partir deste diálogo tem de responder (prende o foco por sua vez)
    const quiet = (n) => n.id === 'toasts' || n.id === 'tooltip' || n.id === 'modals' || n.tagName === 'SCRIPT' || n.tagName === 'STYLE';
    const set = [];
    for (let n = box; n && n.parentElement && n !== document.body; n = n.parentElement) {
      for (const sib of n.parentElement.children) {
        if (sib === n || sib.inert || keep.has(sib) || quiet(sib)) continue;
        sib.inert = true;
        set.push(sib);
      }
    }
    const onKey = (e) => {
      if (e.key !== 'Tab' || traps[traps.length - 1] !== trap) return;
      const list = focusables(box);
      if (!list.length) { e.preventDefault(); return; }
      const i = list.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? list[list.length - 1] : list[i - 1]) : (i < 0 || i === list.length - 1 ? list[0] : list[i + 1]);
      e.preventDefault();
      e.stopPropagation();
      next.focus();
    };
    document.addEventListener('keydown', onKey, true);
    let done = false;
    const trap = {
      box,
      release(restore) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        for (const n of set) n.inert = false;
        const i = traps.indexOf(trap);
        if (i >= 0) traps.splice(i, 1);
        if (restore === false) return;
        const a = document.activeElement;
        if (a && a !== document.body && !box.contains(a) && a.isConnected) return; // o foco já foi para outro sítio
        if (back && back.isConnected && back !== document.body && !back.closest('[inert]') && !back.disabled) back.focus({ preventScroll: true });
        else refocus(backKey);
      },
    };
    traps.push(trap);
    return trap.release;
  }
  const trapOpen = () => traps.length > 0;

  // ---- modais -------------------------------------------------------------------------------------------------
  // modal({title, body: Node|string, buttons:[{label, value, kind:'primary'|'danger'}], dismissible, wide})
  // → Promise(valor do botão; null se fechado com Esc/fundo)
  function modal(spec) {
    return new Promise((resolve) => {
      const host = $('modals');
      let release = null;
      const close = (v) => {
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        if (release) release();
        resolve(v);
      };
      const onKey = (e) => {
        if (back.nextElementSibling) return; // outro diálogo por cima
        // repetição automática de uma tecla premida antes do modal abrir (Enter longo) nunca o confirma
        if (e.repeat && (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); return; }
        if (e.key === 'Escape' && spec.dismissible !== false) { e.preventDefault(); e.stopPropagation(); close(null); }
        if (e.key === 'Enter') {
          // Enter num botão com foco ativa esse botão (Cancelar não confirma); fora dos botões, o principal
          const a = document.activeElement;
          if (a && box.contains(a) && (a.tagName === 'BUTTON' || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return;
          const prim = (spec.buttons || []).find((b) => b.kind === 'primary');
          if (prim) { e.preventDefault(); e.stopPropagation(); close(prim.value); }
        }
      };
      const body = typeof spec.body === 'string' ? el('div', { class: 'modal-text', html: spec.body }) : spec.body;
      // um clique no fundo logo a seguir à abertura vem do mesmo gesto que a abriu (clique fantasma do toque)
      const t0 = performance.now();
      const fresh = () => performance.now() - t0 < 320;
      const btns = (spec.buttons || [{ label: OV.T('common.ok'), value: true, kind: 'primary' }]).map((b) =>
        el('button', { type: 'button', class: 'btn ' + (b.kind || ''), onclick: (e) => { if (e.detail > 1 && fresh()) return; close(b.value); } }, b.label));
      const box = el('div', { class: 'modal' + (spec.wide ? ' wide' : '') + (spec.cls ? ' ' + spec.cls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.title || null },
        spec.title ? el('h2', { class: 'modal-title', text: spec.title }) : null,
        body,
        el('div', { class: 'modal-actions' }, btns));
      const back = el('div', { class: 'modal-back', onclick: (e) => { if (e.target === back && spec.dismissible !== false && !fresh()) close(null); } }, box);
      host.appendChild(back);
      release = trapFocus(back);
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
    longPress(node, () => (typeof content === 'function' ? content() : content));
  }
  function hideTooltip() {
    const t = $('tooltip');
    if (t) t.classList.add('hidden');
  }
  /* toque: sem pairar não há dicas — um toque longo (≥ 450 ms) num nó com dica mostra a etiqueta junto dele (nome e
     tecla) durante 2,6 s e cancela o clique que viria a seguir. Todas as interfaces o têm através de tooltip(). */
  let lpBubble = null, lpHideT = 0;
  function hideLongPress() {
    clearTimeout(lpHideT);
    if (lpBubble) lpBubble.remove();
    lpBubble = null;
  }
  function showLongPress(node, html) {
    hideLongPress();
    if (!html || !node.isConnected) return;
    const b = el('div', { class: 'lp-tip bs-lp', role: 'tooltip', html });
    document.body.appendChild(b);
    const r = node.getBoundingClientRect(), bw = b.offsetWidth, bh = b.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left + r.width / 2 - bw / 2));
    const y = r.top - bh - 10 >= 8 ? r.top - bh - 10 : Math.min(window.innerHeight - bh - 8, r.bottom + 10);
    b.style.left = x + 'px';
    b.style.top = y + 'px';
    lpBubble = b;
    lpHideT = setTimeout(hideLongPress, 2600);
    if (OV.audio && OV.audio.play) OV.audio.play('ui_click', { vol: 0.4 });
  }
  function longPress(node, html) {
    if (node.dataset.lp) return;
    node.dataset.lp = '1';
    let timer = 0, fired = false, x0 = 0, y0 = 0;
    node.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      fired = false;
      x0 = e.clientX;
      y0 = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(() => {
        fired = true;
        showLongPress(node, html());
      }, 450);
    });
    const stop = () => clearTimeout(timer);
    node.addEventListener('pointerup', stop);
    node.addEventListener('pointercancel', stop);
    node.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 10) stop(); });
    node.addEventListener('click', (e) => {
      if (!fired) return;
      fired = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
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

  OV.Dom = { $, el, clear, toast, modal, anyModalOpen, tooltip, hideTooltip, hideLongPress, bar, download, pickFile, trapFocus, trapOpen, focusKey, refocus, focusables };
})(globalThis.OV || (globalThis.OV = {}));
