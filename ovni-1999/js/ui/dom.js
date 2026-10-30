/* Utilitários DOM: criação de elementos, toasts, modais com Promise (foco preso e devolvido), tooltips, barras.
   OV.Dom = { $, el, clear, toast (o mesmo aviso à vista não se repete), clearToasts, modal, anyModalOpen, tooltip (também toque longo no iPad; some ao trocar de cena/abrir modal ou se o nó sair do DOM), hideTooltip, tooltipNode() → nó da dica à vista, hideLongPress, bar,
              download, pickFile,
              trapFocus(caixa, {keep, returnTo}) → release(restore?) ; trapOpen() ; focusKey(nó) → chave única ou null ; refocus(chave, dentro?) ;
              focusables(caixa) ; ghostClick(event, nascido) → true se for o 2.º clique de um duplo clique num botão acabado de aparecer } */
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
    // o mesmo aviso ainda à vista não se empilha: volta a contar o tempo do que já lá está (as confirmações «good»
    // repetem-se, porque cada uma é uma ação que aconteceu)
    const same = kind === 'good' ? null : [...box.children].find((n) => n.textContent === text && !n.classList.contains('fade') && n.dataset.kind === (kind || 'info'));
    if (same) { arm(same); return; }
    const d = el('div', { class: 'toast ' + (kind || 'info'), text, dataset: { kind: kind || 'info' } });
    box.appendChild(d);
    while (box.children.length > 5) box.removeChild(box.firstChild);
    arm(d);
  }
  function arm(d) {
    clearTimeout(d._tf);
    clearTimeout(d._tr);
    d._tf = setTimeout(() => d.classList.add('fade'), 3400);
    d._tr = setTimeout(() => d.remove(), 4100);
  }
  // avisos do ecrã anterior não ficam por cima de um ecrã novo (briefing, base, relatório)
  function clearToasts() {
    const box = $('toasts');
    if (box) clear(box);
  }

  // ---- foco preso num diálogo ------------------------------------------------------------------------------
  // trapFocus(caixa, {keep:[nós], returnTo}) → release(): o resto da página fica inerte (sem foco nem cliques, fora do
  // que está em keep), Tab/⇧Tab dão a volta dentro da caixa e, ao libertar, o foco volta a quem abriu o diálogo.
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const traps = [];
  function focusables(box) {
    return [...box.querySelectorAll(FOCUSABLE)].filter((n) => !n.closest('[inert]') && !n.closest('.hidden') && n.offsetParent !== null);
  }
  /* chave estável de um elemento (para o reencontrar depois de um redesenho). Só serve uma chave que identifique UM nó
     na página: data-* com identidade, id, aria-label ou a combinação; sem isso, o texto do botão e a ordem entre os
     iguais («T␟seletor␟texto␟n»). Nunca uma chave genérica que apanhe o primeiro botão qualquer (ex.: «Novo projeto»). */
  const SEP = '\u241f';
  const qv = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const txtOf = (n) => (n.textContent || '').replace(/\s+/g, ' ').trim();
  function focusKey(n) {
    if (!n || n === document.body || !n.getAttribute || !n.tagName) return null;
    const tag = n.tagName.toLowerCase();
    const doc = n.ownerDocument || document;
    const unique = (sel) => { try { return doc.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
    const ds = n.dataset ? Object.keys(n.dataset) : [];
    const dsSel = ds.map((k) => '[data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + '="' + qv(n.dataset[k]) + '"]').join('');
    const lbl = n.getAttribute('aria-label');
    const lblSel = lbl ? '[aria-label="' + qv(lbl) + '"]' : '';
    const cands = [];
    if (dsSel) cands.push(tag + dsSel);
    if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) cands.push('#' + n.id);
    if (lblSel) cands.push(tag + lblSel);
    if (dsSel && lblSel) cands.push(tag + dsSel + lblSel);
    for (const c of cands) if (unique(c)) return c;
    const base = tag + dsSel + lblSel;
    const txt = txtOf(n);
    if (!txt && !dsSel && !lblSel) return null;
    let same = [];
    try { same = [...doc.querySelectorAll(base)].filter((x) => txtOf(x) === txt); } catch (e) { return null; }
    const i = same.indexOf(n);
    return i < 0 ? null : 'T' + SEP + base + SEP + txt + SEP + i;
  }
  function refocus(key, within) {
    if (!key) return false;
    let n = null;
    if (key.charAt(0) === 'T' && key.charAt(1) === SEP) {
      const [, base, txt, i] = key.split(SEP);
      try { n = [...document.querySelectorAll(base)].filter((x) => txtOf(x) === txt)[+i] || null; } catch (e) { n = null; }
      if (n && within && !within.contains(n)) n = null;
    } else {
      try { n = (within || document).querySelector(key); } catch (e) { n = null; }
    }
    if (!n || n.closest('[inert]') || n.disabled) return false;
    n.focus({ preventScroll: true });
    return document.activeElement === n;
  }
  /* clique fantasma: o 2.º clique de um duplo clique (event.detail ≥ 2) que cai num botão acabado de aparecer (ecrã
     novo no mesmo sítio do anterior) não o ativa. born = instante em que o botão nasceu (performance.now()) */
  const GHOST_MS = 600;
  function ghostClick(e, born) {
    if (!e || (e.detail | 0) < 2) return false;
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return t - (born || 0) < GHOST_MS;
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
      hideTooltip();
      hideLongPress();
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
  /* um nó que aparece debaixo de um ponteiro parado (diálogo novo, botão recriado) não mostra a dica logo: só depois
     de um movimento real do ponteiro (senão a dica do botão por omissão tapa a própria pergunta) */
  let lastMoveT = -1, lastX = NaN, lastY = NaN;
  // nó cuja dica está à vista: se sair do DOM (troca de cena, lista redesenhada) ou deixar de estar sob o
  // ponteiro sem mouseleave, o primeiro movimento seguinte esconde a dica (nunca fica presa sobre outro ecrã)
  let tipNode = null;
  const nowT = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('pointermove', (e) => {
      if (e.clientX === lastX && e.clientY === lastY) return;
      lastX = e.clientX;
      lastY = e.clientY;
      lastMoveT = nowT();
      if (tipNode && (!tipNode.isConnected || (tipNode.matches && !tipNode.matches(':hover')))) hideTooltip();
    }, { capture: true, passive: true });
  }
  function tooltip(node, content) {
    node.addEventListener('mouseenter', function onEnter() {
      if (noHover()) return;
      if (nowT() - lastMoveT > 120) {
        // entrou sem o ponteiro se mexer (o nó apareceu debaixo dele): espera pelo primeiro movimento sobre ele
        const later = () => { node.removeEventListener('pointermove', later); if (node.matches && node.matches(':hover')) onEnter(); };
        node.addEventListener('pointermove', later);
        return;
      }
      const t = $('tooltip');
      const html = typeof content === 'function' ? content() : content;
      if (!html) return;
      if (!node.isConnected) return;
      t.innerHTML = html;
      t.classList.remove('hidden');
      tipNode = node;
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
    tipNode = null;
    const t = typeof document !== 'undefined' ? $('tooltip') : null;
    if (t) t.classList.add('hidden');
  }
  const tooltipNode = () => tipNode;
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
  // nós que já têm o toque longo (fora do DOM: um data-* aqui poluía as chaves de foco de todos os botões)
  const lpDone = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  function longPress(node, html) {
    if (lpDone) { if (lpDone.has(node)) return; lpDone.add(node); }
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

  OV.Dom = { $, el, clear, toast, clearToasts, modal, anyModalOpen, tooltip, hideTooltip, tooltipNode, hideLongPress, bar, download, pickFile, trapFocus, trapOpen, focusKey, refocus, focusables, ghostClick };
})(globalThis.OV || (globalThis.OV = {}));
