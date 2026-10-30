/* Renderizador do Battlescape (DESIGN.md §15.1, §16): lê B (nunca o altera) e a vista do apresentador.
   OV.BattleRender.draw(ctx, B, view)
     view = {cam:{x,y,zoom}, w, h (px CSS), viewZ, time (ms), selectedId, hover:{x,y,z}|null,
             cursor:'move'|'target'|'throw'|'none', path:{steps:[{i, tu, state:'ok'|'reserve'|'out'}], label}|null,
             reach:{cost:Int16Array, budgetOk, budgetReserve}|null,
             target:{fromId, toI, hitPct, blocked, line:[voxel], route?, label?, sub?, subCol?, blockI?, blast?}|null,
             throwArc:[voxel]|null, throwInfo:{toI, ok, label, sub?, blast?:{x,y,z,r,smoke,risk}}|null, throwRange:{x,y,z,r}|null, blips:[{x,y,z,size,t0}]|null,
             anim:{units:{[id]:{fx,fy,fz,dir,pose,frame,flash?,show?}}, hidden:Set|[id], hideItems:Set}, showAll, nodes}
     anim.units[id].show = desenhar mesmo fora de vista (animação em curso); target.sub = segunda etiqueta (aviso);
     path.lock = destino bloqueado à espera de confirmação (pulsa); path.noLine = só o destino (inalcançável);
     target.blockI = tile do obstáculo que tapa o tiro (losango vermelho); dangers = [{x,y,z,r}] granadas ativadas no chão; safe = {t,r,b,l} px CSS ocupados pelo HUD
     (as etiquetas ficam dentro do resto do ecrã). clampCam(view, B) usa view.viewZ (0 por omissão).
     view.kcur = {x,y,z} cursor de teclado (contorno branco/preto bem visível); view.palette 'normal'|'cvd';
     view.reduceMotion (sem pulsações); view.textScale (etiquetas); path.sub = segunda etiqueta (dica da porta, reserva; path.subCol = nome da paleta).
     Escreve view.targetLabel = {right, x, y, tx, ty} (px CSS): onde ficaram as etiquetas do alvo (do lado oposto ao atirador).
     Formas independentes da cor: passos que guardam a reserva = pontos cheios, que a comem = pontos ocos ligados a
     tracejado (com uma barra onde a reserva acaba), inalcançáveis = ✕; contorno do alcance cheio (mantém a
     reserva) e tracejado (come a reserva); inimigo à vista = losango com cantos + seta por cima da cabeça
     (soldados = elipse); unidades visíveis tapadas por paredes/objetos à frente aparecem em transparência.
   Ordem (§16): para z = 0..viewZ — chão pré-cozido em regiões de 512×256 px de mundo alinhadas ao ecrã (luz, névoa e
   escurecimento por nível já compostos por tile; recozidas só quando a assinatura chão/sombra muda, no máximo
   2 por fotograma) + decalques + área alcançável + cursor (metade de trás); varrimento diagonal s = x+y:
   parede oeste, parede norte, itens, objeto, unidades, frente do cursor, fogo/fumo. Níveis acima de viewZ cortados,
   abaixo escurecidos 12 % por nível. Depois: brilhos aditivos, caminho com UT, linha de tiro, arco, FX, barras.
   Névoa: tiles por descobrir a negro (map.disc), descobertos mas fora de vista a 55 % + dessaturados; inimigos só
   se vistos pela X-COM (B._.visible / u.visible / u.vis, lidos com cautela: sem informação desenha todos).
   Luz: B._.light (0..15) quando calculada pela LOS; senão uma aproximação cosmética local (ambiente + fontes).
   pick(view, px, py) → {x, y, z, unitId|null}|null ; bounds(B) ; centerOn(view, x, y, z) ; markDirty(i?) ;
   reset(B) (nova batalha: estado do zero + prewarm em segundo plano) ; prewarm(B, opts?) ; warmStats() ;
   labels() → [{x0,y0,x1,y1,text}] e unitRects() → [{unitId,x0,y0,x1,y1}] do último fotograma (px CSS) */
(function (OV) {
  'use strict';

  const Col = OV.Color;
  const css = Col.css;
  const TAU = Math.PI * 2;
  // região de chão pré-cozida (px de mundo, alinhada ao ecrã). O tamanho em px do dispositivo fica fixo em
  // REGION_DEV × REGION_DEV/2 para qualquer zoom: telas maiores deixam de ser aceleradas no Chrome/Safari e cada
  // cópia passa a reenviar a tela inteira para a GPU (a zoom 2 @2× custava ~10 ms por fotograma)
  const REGION_DEV = 1024;
  let RW = 512, RH = 256;
  function regionGrid(st, S) {
    const rw = Math.max(128, Math.round(REGION_DEV / S / 32) * 32);
    if (st.rw !== rw) {
      st.chunks.clear();
      st.chunkPx = 0;
      st.forced.clear();
      st.rw = rw;
    }
    RW = rw;
    RH = rw >> 1;
  }
  const mapRegionRange = (m) => ({ rx0: Math.floor((-m.h * 32 - 32) / RW), rx1: Math.floor((m.w * 32 + 32) / RW), ry0: 0, ry1: Math.floor(((m.w + m.h) * 16 + 32) / RH) });
  const NIGHT = 0x050a1e;
  const FOG_DIM = 0.55, FOG_GRAY = 0.6, LEVEL_DIM = 0.12;
  const SHADE_A = (s) => Math.min(0.85, (Math.max(0, s) / 15) * 0.85);
  const COL = {
    ok: 0x4ade6a, reserve: 0xffd23a, out: 0xff4a3a, move: 0xffd23a, target: 0xff4a3a, throw: 0xff9a30, none: 0xc8d2dc,
    // barras por cima do soldado com as mesmas cores do cartão (css/base.css --tu, --hp, --stun)
    select: 0xffc23a, tu: 0x58c8ff, hp: 0x5fe08a, stun: 0x9aa4ae, own: 0x58c8ff,
  };
  // paleta segura para daltonismo (view.palette 'cvd'): azul / laranja / magenta / branco em vez de verde / amarelo /
  // vermelho; as formas (pontos cheios/ocos, tracejado, ✕, losango inimigo) estão sempre ligadas
  const COL_CVD = Object.assign({}, COL, {
    ok: 0x4aa8ff, reserve: 0xff9a30, out: 0xff4fd8, move: 0xffffff, target: 0xff4fd8, throw: 0xffb060, select: 0xffffff, own: 0x4aa8ff,
  });
  let PAL = COL;
  const RANK_COL = [0x9aa4ae, 0x5ac85a, 0xd8c040, 0x5ab4ff, 0xff9a40, 0xe04ae0, 0xff4a4a];

  let makeCanvas = function (w, h) {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    throw new Error('BattleRender: sem canvas disponível');
  };
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  // ---- estado de renderização por B (caches; nada disto vai para B) --------------------------------------
  const states = new WeakMap();
  let chunkBudget = 48e6;
  let last = null; // último desenho: para pick()
  const statsInfo = { ms: 0, chunks: 0, bakes: 0, direct: 0, sprites: 0, units: 0 };
  const DBG = {}; // interruptores de QA (perfil): noChunks, noSweep, noGlow, noFire, noUnits, noSprites
  let frameNo = 0;
  let labels = []; // etiquetas do último fotograma (px CSS), para o QA
  let bakesPerFrame = 2;

  function stateOf(B) {
    const m = B.map;
    let st = states.get(B);
    if (!st || st.n !== m.n || st.w !== m.w) {
      const variant = new Uint8Array(m.n);
      const h32 = OV.U && OV.U.hash32;
      for (let i = 0; i < m.n; i++) {
        const z = (i / (m.w * m.h)) | 0, r = i - z * m.w * m.h, y = (r / m.w) | 0, x = r - y * m.w;
        variant[i] = h32 ? h32(x, y, z) & 255 : (x * 73856093 ^ y * 19349663 ^ z * 83492791) & 255;
      }
      st = {
        n: m.n, w: m.w, chunks: new Map(), chunkPx: 0, variant, version: 0, forced: new Set(),
        light: null, lightSig: -1, pool: [], unitInfo: new Map(), sprMemo: new Map(), sprS: 0,
      };
      states.set(B, st);
    }
    return st;
  }

  // invalida o chão/luz à volta do tile i (eventos 'tile'); sem argumento invalida tudo
  function markDirty(i, B) {
    const tgt = B || (last && last.B);
    if (!tgt) return;
    const st = stateOf(tgt);
    if (st.rw) {
      RW = st.rw;
      RH = st.rw >> 1;
    }
    st.version++;
    if (i === undefined || i === null || i < 0) {
      st.chunks.clear();
      st.chunkPx = 0;
      return;
    }
    const m = tgt.map, plane = m.w * m.h;
    const z = (i / plane) | 0, r = i - z * plane, y = (r / m.w) | 0, x = r - y * m.w;
    // o recorte do chão (TileSprites.floorState) depende dos objetos dos vizinhos e do nível de baixo: invalida o
    // bloco 3×3 neste nível e no de cima
    for (let zz = z; zz <= Math.min(m.d - 1, z + 1); zz++) {
      for (let yy = Math.max(0, y - 1); yy <= Math.min(m.h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(m.w - 1, x + 1); xx++) forceTile(st, xx, yy, zz);
      }
    }
  }
  function forceTile(st, x, y, z) {
    const wx = (x - y) * 32, wy = (x + y) * 16;
    for (let ry = Math.floor(wy / RH); ry <= Math.floor((wy + 32) / RH); ry++) {
      for (let rx = Math.floor((wx - 32) / RW); rx <= Math.floor((wx + 32) / RW); rx++) st.forced.add(chunkKey(z, rx + 2048, ry + 2048));
    }
  }
  const chunkKey = (z, cx, cy) => (z * 4096 + cy) * 4096 + cx;

  // ---- leituras defensivas de B._ --------------------------------------------------------------------------------
  function anyNonZero(a) {
    if (!a) return false;
    for (let i = 0; i < a.length; i++) if (a[i]) return true;
    return false;
  }
  function seenByXcom(B, u) {
    const V = B._ && B._.visible;
    if (V) {
      const s = V.xcom !== undefined ? V.xcom : V;
      if (s instanceof Set || s instanceof Map) return s.has(u.id);
      if (Array.isArray(s)) return s.indexOf(u.id) >= 0;
      if (ArrayBuffer.isView(s)) return !!s[u.id];
      if (s && typeof s === 'object') return !!s[u.id];
    }
    if (typeof u.visible === 'boolean') return u.visible;
    if (u.vis !== undefined && u.vis !== null) {
      if (typeof u.vis === 'boolean') return u.vis;
      if (typeof u.vis === 'object' && u.vis.xcom !== undefined) return !!u.vis.xcom;
    }
    // sem informação de visibilidade: escondido (nunca revelar inimigos antes do primeiro cálculo de LOS)
    return false;
  }

  // luz cosmética quando a LOS ainda não calculou B._.light (mesmas regras do DESIGN §8)
  function fallbackLight(B, st) {
    const m = B.map, D = OV.Data.tileDefs;
    const shade = B.mission && B.mission.shade !== undefined ? B.mission.shade | 0 : 0;
    let sig = shade * 7919 + st.version * 31;
    for (let i = 0; i < m.n; i++) if (m.fire[i]) sig = (sig * 33 + i * 7 + m.fire[i]) | 0;
    for (const it of B.items) if (it.at !== null && it.at !== undefined) sig = (sig * 33 + it.at * 13 + (it.type.length | 0)) | 0;
    for (const u of B.units) if (u.burn > 0 && u.onMap) sig = (sig * 33 + u.x * 17 + u.y) | 0;
    if (st.light && st.lightSig === sig) return st.light;
    const L = st.light && st.light.length === m.n ? st.light : new Uint8Array(m.n);
    const amb = 15 - shade, plane = m.w * m.h;
    for (let c = 0; c < plane; c++) {
      let covered = false;
      for (let z = m.d - 1; z >= 0; z--) {
        const i = z * plane + c;
        L[i] = Math.max(0, amb - (covered && amb >= 11 ? 2 : 0));
        if (z > 0 && m.parts[i * 4]) covered = true;
      }
    }
    const addLight = (x, y, p) => {
      for (let dy = -p; dy <= p; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= m.h) continue;
        for (let dx = -p; dx <= p; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= m.w) continue;
          const v = p - Math.round(Math.sqrt(dx * dx + dy * dy));
          if (v <= 0) continue;
          for (let z = 0; z < m.d; z++) {
            const i = (z * m.h + yy) * m.w + xx;
            if (L[i] < v) L[i] = v;
          }
        }
      }
    };
    for (let i = 0; i < m.n; i++) {
      const r = i % plane, x = r % m.w, y = (r / m.w) | 0;
      if (m.fire[i]) addLight(x, y, 15);
      const o = m.parts[i * 4 + 3];
      if (o && D[o] && D[o].light) addLight(x, y, D[o].light);
    }
    for (const it of B.items) {
      if (it.at === null || it.at === undefined || it.owner !== null) continue;
      const d = OV.Data.items[it.type];
      if (d && d.light) {
        const r = it.at % plane;
        addLight(r % m.w, (r / m.w) | 0, d.light);
      }
    }
    for (const u of B.units) if (u.burn > 0 && u.onMap) addLight(u.x, u.y, 15);
    st.light = L;
    st.lightSig = sig;
    return L;
  }

  // ---- sprites de tile com memo numérico por escala ---------------------------------------------------------------
  /* Os sprites de tile só se geram às escalas dos zooms de repouso (ZOOM_STEPS × dpr); a meio de uma animação de
     zoom ou de um gesto de pinça desenha-se o sprite da escala de repouso logo acima, reduzido pelo drawImage. Sem
     isto cada escala intermédia (quantizada a 0.25) gerava todos os sprites visíveis: 80–200 ms no primeiro zoom. */
  const ZOOM_STEPS = [1, 0.75, 1.5, 0.5, 2];
  let snapDpr = 0, snapScales = [];
  const qS = (s) => Math.max(0.25, Math.round(s * 4) / 4);
  function spriteScale(S, dpr) {
    if (dpr !== snapDpr) {
      snapDpr = dpr;
      snapScales = Array.from(new Set(ZOOM_STEPS.map((z) => qS(z * dpr)))).sort((a, b) => a - b);
    }
    for (const k of snapScales) if (k >= S - 1e-6) return k;
    return S;
  }
  function tileSpr(st, S, defId, v, state) {
    S = spriteScale(S, st.dpr || 1);
    if (st.sprS !== S) {
      st.sprMemo.clear();
      st.sprS = S;
    }
    const k = (defId * 256 + v) * 8 + (state === 'y' ? 5 : state === 'b' ? 6 : state | 0);
    let spr = st.sprMemo.get(k);
    if (spr === undefined) {
      spr = OV.TileSprites.get(defId, v, S, state);
      st.sprMemo.set(k, spr);
      if (st.sprMemo.size > 4000) st.sprMemo.clear();
    }
    return spr;
  }
  // orientação da linha do casco numa porta de OVNI ('x' ou 'y')
  function doorOri(m, x, y, z) {
    const D = OV.Data.tileDefs;
    const solid = (xx, yy) => {
      if (xx < 0 || yy < 0 || xx >= m.w || yy >= m.h) return false;
      const o = m.parts[((z * m.h + yy) * m.w + xx) * 4 + 3];
      return !!(o && D[o] && (D[o].fullBlock || D[o].door === 'ufo'));
    };
    const ax = solid(x - 1, y) || solid(x + 1, y), ay = solid(x, y - 1) || solid(x, y + 1);
    return ay && !ax ? 'y' : 'x';
  }
  // meia-laje do chão junto a cascos diagonais / cúpulas (sprites_tiles); 0 = chão inteiro
  const floorStateOf = (m, x, y, z) => (OV.TileSprites.floorState ? OV.TileSprites.floorState(m, x, y, z) : 0);
  function animState(defId, st, i, time) {
    const TS = OV.TileSprites;
    const f = TS.frames(defId);
    if (f <= 1) return 0;
    return (Math.floor(time / 240) + st.variant[i]) % f;
  }

  // ---- regiões de chão pré-cozidas (retângulos alinhados ao ecrã, chão + luz/névoa já compostos) ---------------
  // código de sombra (0..255) de um tile com chão; bit 256 = fora de vista (dessaturar)
  function tileShadeCode(m, F, i, z) {
    if (!(m.parts[i * 4] || z === 0)) return 0;
    if (!(F.revealAll || m.disc[i] & 1)) return 255;
    const vis = F.allVisible || F.vis[i];
    const a = 1 - (1 - SHADE_A(15 - F.light[i])) * (vis ? 1 : 1 - FOG_DIM) * (1 - LEVEL_DIM * (F.viewZ - z));
    return Math.round(a * 255) | (vis ? 0 : 256);
  }
  // percorre os tiles cujo losango interseta a região (rx, ry) do nível z, de trás para a frente
  function forRegionTiles(m, rx, ry, fn) {
    const d0 = Math.floor((rx * RW) / 32) - 1, d1 = Math.ceil(((rx + 1) * RW) / 32) + 1;
    const s0 = Math.max(0, Math.floor((ry * RH) / 16) - 2), s1 = Math.min(m.w + m.h - 2, Math.ceil(((ry + 1) * RH) / 16));
    for (let s = s0; s <= s1; s++) {
      const xa = Math.max(0, s - (m.h - 1), Math.ceil((s + d0) / 2)), xb = Math.min(m.w - 1, s, Math.floor((s + d1) / 2));
      for (let x = xa; x <= xb; x++) fn(x, s - x);
    }
  }
  function regionSig(B, F, z, rx, ry) {
    const m = B.map;
    let h = 2166136261;
    forRegionTiles(m, rx, ry, (x, y) => {
      const i = (z * m.h + y) * m.w + x;
      h = Math.imul(h ^ m.parts[i * 4], 16777619);
      h = Math.imul(h ^ tileShadeCode(m, F, i, z), 16777619);
    });
    return h >>> 0;
  }
  function floorBlit(g, m, st, F, i, z, x, y, X, Y, S, spr) {
    const code = tileShadeCode(m, F, i, z);
    if (code === 255 && !(F.revealAll || m.disc[i] & 1)) {
      // por descobrir: losango negro
      diamond(g, X, Y, S, -0.6);
      g.fillStyle = '#000000';
      g.fill();
      return;
    }
    const dark = (code & 255) / 255;
    OV.TileSprites.blitDev(g, spr, X, Y, S, dark < 0.01 ? 0 : dark, code & 256 && dark < 1 ? FOG_GRAY : 0);
  }
  function bakeRegion(B, st, F, z, rx, ry, S) {
    const m = B.map;
    const W = Math.round(RW * S), H = Math.round(RH * S);
    const ox = rx * RW, oy = ry * RH - z * 48; // canto da região em px de mundo
    let c = null, g = null;
    // caixa do conteúdo (px do dispositivo): só esta parte se compõe no ecrã (níveis altos quase vazios)
    let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
    forRegionTiles(m, rx, ry, (x, y) => {
      const i = (z * m.h + y) * m.w + x;
      const f = m.parts[i * 4];
      if (!f) return;
      const spr = tileSpr(st, S, f, st.variant[i], floorStateOf(m, x, y, z));
      if (!spr) return;
      if (!c) {
        c = st.pool.pop() || null;
        if (c && (c.width !== W || c.height !== H)) c = null;
        if (!c) c = makeCanvas(W, H);
        g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.clearRect(0, 0, W, H);
      }
      const X = ((x - y) * 32 - ox) * S, Y = ((x + y) * 16 - z * 48 - oy) * S;
      floorBlit(g, m, st, F, i, z, x, y, X, Y, S, spr);
      const sx0 = X - spr.ax * S, sy0 = Y - spr.ay * S;
      if (sx0 < bx0) bx0 = sx0;
      if (sy0 < by0) by0 = sy0;
      if (sx0 + spr.w * S > bx1) bx1 = sx0 + spr.w * S;
      if (sy0 + spr.h * S > by1) by1 = sy0 + spr.h * S;
    });
    statsInfo.bakes++;
    const box = c ? [Math.max(0, Math.floor(bx0) - 1), Math.max(0, Math.floor(by0) - 1), Math.min(W, Math.ceil(bx1) + 1), Math.min(H, Math.ceil(by1) + 1)] : null;
    return { c, S, px: c ? W * H : 0, box };
  }
  function dropRegion(st, k) {
    const ch = st.chunks.get(k);
    if (!ch) return;
    st.chunkPx -= ch.px;
    st.chunks.delete(k);
    if (ch.c && st.pool.length < 8) st.pool.push(ch.c);
  }
  function getRegion(B, st, F, z, rx, ry, S) {
    const k = chunkKey(z, rx + 2048, ry + 2048);
    const sig = regionSig(B, F, z, rx, ry);
    let ch = st.chunks.get(k);
    if (ch && ch.S === S && ch.sig === sig && !st.forced.has(k)) {
      st.chunks.delete(k);
      st.chunks.set(k, ch);
      return ch;
    }
    // orçamento de cozeduras por fotograma: o resto desenha-se tile a tile neste fotograma
    if (F.bakeLeft <= 0) return null;
    F.bakeLeft--;
    dropRegion(st, k);
    st.forced.delete(k);
    ch = bakeRegion(B, st, F, z, rx, ry, S);
    ch.sig = sig;
    st.chunks.set(k, ch);
    st.chunkPx += ch.px;
    while (st.chunkPx > chunkBudget && st.chunks.size > 1) dropRegion(st, st.chunks.keys().next().value);
    return ch;
  }
  // chão de uma região desenhado diretamente (sem cozer), recortado ao retângulo da região
  function drawRegionDirect(ctx, B, st, F, z, rx, ry) {
    const m = B.map, S = F.S;
    const X0 = rx * RW * S + F.ox, Y0 = (ry * RH - z * 48) * S + F.oy;
    ctx.save();
    ctx.beginPath();
    ctx.rect(X0, Y0, RW * S, RH * S);
    ctx.clip();
    forRegionTiles(m, rx, ry, (x, y) => {
      const i = (z * m.h + y) * m.w + x;
      const f = m.parts[i * 4];
      if (!f) return;
      const spr = tileSpr(st, S, f, st.variant[i], floorStateOf(m, x, y, z));
      if (spr) floorBlit(ctx, m, st, F, i, z, x, y, (x - y) * 32 * S + F.ox, ((x + y) * 16 - z * 48) * S + F.oy, S, spr);
    });
    ctx.restore();
  }

  // ---- unidades ---------------------------------------------------------------------------------------------------
  function unitInfo(B, st, u) {
    const key = u.items.R + ',' + u.items.L + ',' + u.armourId + ',' + u.rank + ',' + u.side;
    let inf = st.unitInfo.get(u.id);
    if (inf && inf.key === key) return inf;
    const IT = OV.Data.items;
    let weapon = 'none', gun = 'ballistic';
    for (const h of ['R', 'L']) {
      const it = OV.BUnits && OV.BUnits.findItem ? OV.BUnits.findItem(B, u.items[h]) : null;
      const d = it && IT[it.type];
      if (!d || (d.kind !== 'firearm' && d.kind !== 'melee' && d.kind !== 'psiamp')) continue;
      weapon = d.size >= 4 ? 'heavy' : d.twoHanded ? 'rifle' : 'pistol';
      gun = /plasma/.test(it.type) ? 'plasma' : /laser/.test(it.type) ? 'laser' : 'ballistic';
      break;
    }
    let skin = 0;
    if (OV.Portraits && OV.Portraits.traits && (u.sprite === 'soldier' || u.side === 'civ')) {
      try {
        skin = Math.min(3, Math.floor((OV.Portraits.traits(u).skinIdx || 0) * 4 / 10));
      } catch (e) {
        skin = (u.portraitSeed >>> 0) & 3;
      }
    } else skin = (u.portraitSeed >>> 0) & 3;
    const rank = typeof u.rank === 'number' ? u.rank : 0;
    inf = {
      key,
      opts: { armour: u.armourId || 'coveralls', skin, female: !!u.female, weapon, gun, team: u.origSide || u.side, rank, variant: (u.id * 5) & 7 },
    };
    st.unitInfo.set(u.id, inf);
    return inf;
  }
  // tile de ancoragem para a ordem de pintura (maior x+y entre origem e destino; 2×2 pela célula da frente)
  function anchorOf(fx, fy, dir, size) {
    let ax, ay;
    if (dir === 1) { ax = Math.ceil(fx - 1e-6); ay = Math.floor(fy + 1e-6); }
    else if (dir === 5) { ax = Math.floor(fx + 1e-6); ay = Math.ceil(fy - 1e-6); }
    else { ax = Math.ceil(fx - 1e-6); ay = Math.ceil(fy - 1e-6); }
    if (size > 1) { ax++; ay++; }
    return [ax, ay];
  }

  // ---- primitivas de sobreposição (px do dispositivo) ----------------------------------------------------------
  function diamond(ctx, X, Y, S, inset) {
    const e = inset || 0;
    ctx.beginPath();
    ctx.moveTo(X, Y + e * S);
    ctx.lineTo(X + (32 - e * 2) * S, Y + 16 * S);
    ctx.lineTo(X, Y + (32 - e) * S);
    ctx.lineTo(X - (32 - e * 2) * S, Y + 16 * S);
    ctx.closePath();
  }
  function cursorBack(ctx, F, X, Y, mode) {
    const S = F.S, col = PAL[mode] || PAL.move;
    diamond(ctx, X, Y, S, 1);
    ctx.fillStyle = css(col, mode === 'target' ? 0.16 : 0.12);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 2 * F.dpr);
    ctx.strokeStyle = css(0x000000, 0.45);
    ctx.beginPath();
    ctx.moveTo(X - 31 * S, Y + 16 * S);
    ctx.lineTo(X, Y + 0.5 * S);
    ctx.lineTo(X + 31 * S, Y + 16 * S);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 1.2 * F.dpr);
    ctx.strokeStyle = css(col, 0.95);
    ctx.stroke();
  }
  function cursorFront(ctx, F, X, Y, mode) {
    const S = F.S, col = PAL[mode] || PAL.move;
    ctx.lineWidth = Math.max(1, 2 * F.dpr);
    ctx.strokeStyle = css(0x000000, 0.45);
    ctx.beginPath();
    ctx.moveTo(X - 31 * S, Y + 16 * S);
    ctx.lineTo(X, Y + 31.5 * S);
    ctx.lineTo(X + 31 * S, Y + 16 * S);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 1.2 * F.dpr);
    ctx.strokeStyle = css(col, 0.95);
    ctx.stroke();
    if (mode === 'target' || mode === 'throw') {
      // cantos de mira
      const cx = X, cy = Y + 16 * S, r = 22 * S;
      ctx.lineWidth = Math.max(1, 1.6 * F.dpr);
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(cx + sx * r, cy + sy * r * 0.5 - sy * 6 * S);
        ctx.lineTo(cx + sx * r, cy + sy * r * 0.5);
        ctx.lineTo(cx + sx * r - sx * 8 * S, cy + sy * r * 0.5);
      }
      ctx.stroke();
    }
  }
  // medida de uma etiqueta (px do dispositivo)
  function pillSize(ctx, F, text) {
    const fs = Math.round(12 * F.dpr * (F.ts || 1));
    ctx.font = '600 ' + fs + 'px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
    return { w: ctx.measureText(text).width + 12 * F.dpr, h: fs + 8 * F.dpr, fs };
  }
  // área livre do ecrã (px do dispositivo): sem o HUD de cima/baixo (view.safe em px CSS, posto pela interface)
  function safeBox(F) {
    const sf = F.view.safe || {}, d = F.dpr, m = 8 * d;
    return { x0: (sf.l || 0) * d + m, y0: (sf.t || 0) * d + m, x1: F.W - (sf.r || 0) * d - m, y1: F.H - (sf.b || 0) * d - m };
  }
  // etiqueta: X é o centro (align 'center'), a aresta esquerda ('left') ou a direita ('right'); fica sempre no ecrã
  function pill(ctx, F, X, Y, text, col, bg, align) {
    const { w, h } = pillSize(ctx, F, text);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = css(bg === undefined || bg === null ? 0x0b0f14 : bg, 0.86);
    ctx.strokeStyle = css(col, 0.9);
    ctx.lineWidth = Math.max(1, F.dpr);
    const sb = safeBox(F);
    let x0 = align === 'left' ? X : align === 'right' ? X - w : X - w / 2, y0 = Y - h / 2;
    x0 = Math.round(Math.max(sb.x0, Math.min(sb.x1 - w, x0)));
    y0 = Math.round(Math.max(sb.y0, Math.min(sb.y1 - h, y0)));
    X = x0 + w / 2;
    Y = y0 + h / 2;
    labels.push({ x0: x0 / F.dpr, y0: y0 / F.dpr, x1: (x0 + w) / F.dpr, y1: (y0 + h) / F.dpr, text });
    const r = 4 * F.dpr;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x0 + w - r, y0);
    ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    ctx.lineTo(x0 + w, y0 + h - r);
    ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
    ctx.lineTo(x0 + r, y0 + h);
    ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
    ctx.lineTo(x0, y0 + r);
    ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = css(col);
    ctx.fillText(text, X, Y + 0.5 * F.dpr);
  }
  function smallText(ctx, F, X, Y, text, col) {
    const fs = Math.round(10.5 * F.dpr * (F.ts || 1));
    ctx.font = '700 ' + fs + 'px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3 * F.dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, X, Y);
    ctx.fillStyle = css(col);
    ctx.fillText(text, X, Y);
  }

  // contorno da área alcançável no nível z (verde = mantém a reserva, amarelo = alcançável)
  function drawReach(ctx, B, F, z) {
    const R = F.view.reach;
    if (!R || !R.cost) return;
    const m = B.map, cost = R.cost;
    const a = Math.min(R.budgetOk | 0, R.budgetReserve | 0), b = Math.max(R.budgetOk | 0, R.budgetReserve | 0);
    const known = (i) => F.revealAll || (m.disc[i] & 1);
    const inner = (i) => cost[i] >= 0 && cost[i] <= a && known(i);
    const outer = (i) => cost[i] >= 0 && cost[i] <= b && known(i);
    const S = F.S;
    const segs = { inner: [], outer: [] };
    const plane = m.w * m.h;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const i = z * plane + y * m.w + x;
        if (!outer(i)) continue;
        const X = (x - y) * 32 * S + F.ox, Y = ((x + y) * 16 - z * 48) * S + F.oy;
        if (X < -40 * S || X > F.W + 40 * S || Y < -40 * S || Y > F.H + 40 * S) continue;
        const nb = [y > 0 ? i - m.w : -1, x < m.w - 1 ? i + 1 : -1, y < m.h - 1 ? i + m.w : -1, x > 0 ? i - 1 : -1];
        const pts = [[X, Y], [X + 32 * S, Y + 16 * S], [X, Y + 32 * S], [X - 32 * S, Y + 16 * S]];
        const isIn = inner(i);
        for (let k = 0; k < 4; k++) {
          const j = nb[k];
          const p = pts[k], q = pts[(k + 1) & 3];
          if (j < 0 || !outer(j)) segs.outer.push(p, q);
          if (isIn && (j < 0 || !inner(j))) segs.inner.push(p, q);
        }
      }
    }
    // contorno cheio = alcance que guarda a reserva; tracejado = só chegando lá come a reserva
    for (const [list, col, dash] of [[segs.outer, PAL.reserve, true], [segs.inner, PAL.ok, false]]) {
      if (!list.length) continue;
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 2) {
        ctx.moveTo(list[k][0], list[k][1]);
        ctx.lineTo(list[k + 1][0], list[k + 1][1]);
      }
      ctx.setLineDash(dash ? [6 * F.dpr, 5 * F.dpr] : []);
      ctx.lineWidth = Math.max(1, 3 * F.dpr);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
      ctx.lineWidth = Math.max(1, (dash ? 1.6 : 1.8) * F.dpr);
      ctx.strokeStyle = css(col, 0.85);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ---- desenho principal --------------------------------------------------------------------------------------------
  function frameInfo(ctx, B, view) {
    const T = ctx.getTransform ? ctx.getTransform() : { a: 1, d: 1, e: 0, f: 0 };
    const dpr = T.a || 1;
    const cam = view.cam || { x: 0, y: 0, zoom: 1 };
    const zoom = cam.zoom || 1;
    const sh = OV.FX && OV.FX.offset ? OV.FX.offset() : { x: 0, y: 0 };
    const S = Math.max(0.25, Math.round(zoom * dpr * 4) / 4);
    const canvas = ctx.canvas || {};
    const wCss = view.w || (canvas.width ? canvas.width / dpr : 1280);
    const hCss = view.h || (canvas.height ? canvas.height / dpr : 800);
    const m = B.map;
    const _ = B._ || {};
    const lightReady = anyNonZero(_.light);
    const visReady = anyNonZero(_.visTiles);
    const discReady = anyNonZero(m.disc);
    const viewZ = Math.max(0, Math.min(m.d - 1, view.viewZ === undefined ? m.d - 1 : view.viewZ | 0));
    return {
      view, dpr, S, zoom, cam, sh, viewZ,
      // origem do mundo em px do dispositivo (o canto superior do tile (0,0,0) fica em (ox, oy))
      ox: Math.round((-cam.x * zoom + sh.x) * dpr + (T.e || 0)), oy: Math.round((-cam.y * zoom + sh.y) * dpr + (T.f || 0)),
      W: wCss * dpr, H: hCss * dpr, wCss, hCss, te: T.e || 0, tf: T.f || 0,
      time: view.time !== undefined ? view.time : now(),
      revealAll: !!view.showAll || !discReady,
      allVisible: !!view.showAll || !visReady,
      vis: _.visTiles,
      light: null, lightReady, frameNo: ++frameNo, bakeLeft: bakesPerFrame,
      ts: Math.max(1, Math.min(1.5, +view.textScale || 1)), still: !!view.reduceMotion,
    };
  }

  function draw(ctx, B, view) {
    const t0 = now();
    view = view || {};
    const m = B.map, D = OV.Data.tileDefs, TS = OV.TileSprites;
    const st = stateOf(B);
    const F = frameInfo(ctx, B, view);
    st.dpr = F.dpr;
    labels = [];
    PAL = view.palette === 'cvd' ? COL_CVD : COL;
    // regiões cozidas à escala de repouso (a mesma dos sprites): a meio de um zoom desenham-se reescaladas
    const SS = spriteScale(F.S, F.dpr);
    regionGrid(st, SS);
    F.light = F.lightReady ? B._.light : fallbackLight(B, st);
    const S = F.S, dpr = F.dpr;
    statsInfo.chunks = 0;
    statsInfo.bakes = 0;
    statsInfo.direct = 0;
    statsInfo.sprites = 0;
    statsInfo.units = 0;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;

    // índices dinâmicos deste fotograma: unidades por tile de ancoragem, itens por tile
    const anim = view.anim || {};
    const animUnits = anim.units || {};
    const hidden = anim.hidden instanceof Set ? anim.hidden : new Set(anim.hidden || []);
    const unitsAt = new Map();
    const rects = [];
    for (const u of B.units) {
      if (hidden.has(u.id)) continue;
      const a = animUnits[u.id];
      if (!a && !(u.onMap && (u.status === 'ok' || u.status === 'panic'))) continue;
      const fx = a && a.fx !== undefined ? a.fx : u.x, fy = a && a.fy !== undefined ? a.fy : u.y, fz = a && a.fz !== undefined ? a.fz : u.z;
      const lz = Math.round(fz);
      if (lz > F.viewZ || lz < 0) continue;
      const forced = !!(a && a.show);
      if (u.side !== 'xcom' && !view.showAll && !forced && !seenByXcom(B, u)) continue;
      const dir = a && a.dir !== undefined ? a.dir : u.dir;
      const size = u.size || 1;
      const [ax, ay] = anchorOf(fx, fy, dir, size);
      const cx = Math.max(0, Math.min(m.w - 1, ax)), cy = Math.max(0, Math.min(m.h - 1, ay));
      const ti = (lz * m.h + cy) * m.w + cx;
      const bx = Math.max(0, Math.min(m.w - 1, Math.round(fx))), by = Math.max(0, Math.min(m.h - 1, Math.round(fy)));
      const ownTile = (lz * m.h + by) * m.w + bx;
      if (u.side !== 'xcom' && !F.revealAll && !forced && !(m.disc[ownTile] & 1)) continue;
      const rec = { u, a, fx, fy, fz, dir, size, ownTile };
      const list = unitsAt.get(ti);
      if (list) list.push(rec);
      else unitsAt.set(ti, [rec]);
    }
    const itemsAt = new Map();
    const hideItems = anim.hideItems instanceof Set ? anim.hideItems : null;
    for (const it of B.items) {
      if (it.at === null || it.at === undefined || it.owner !== null) continue;
      if (hideItems && hideItems.has(it.id)) continue;
      const list = itemsAt.get(it.at);
      if (list) list.push(it);
      else itemsAt.set(it.at, [it]);
    }
    const glows = [];
    const hover = view.hover && view.hover.z <= F.viewZ ? view.hover : null;
    const hoverI = hover ? (hover.z * m.h + hover.y) * m.w + hover.x : -1;
    const mode = view.cursor || 'move';

    // retângulo visível em coordenadas de mundo
    const wx0 = (-F.ox) / S, wx1 = (F.W - F.ox) / S, wy0 = (-F.oy) / S, wy1 = (F.H - F.oy) / S;
    const nightK = Math.max(0, Math.min(1, ((B.mission && B.mission.shade) | 0) / 13));

    for (let z = 0; z <= F.viewZ; z++) {
      const lvlDim = LEVEL_DIM * (F.viewZ - z);
      // -- passe 1: chão (regiões pré-cozidas visíveis, sem sobreposição entre si)
      if (!DBG.noChunks) {
        const rx0 = Math.floor(wx0 / RW), rx1 = Math.floor(wx1 / RW);
        const ry0 = Math.floor((wy0 + z * 48) / RH), ry1 = Math.floor((wy1 + z * 48) / RH);
        const lim = mapRegionRange(m);
        for (let ry = Math.max(ry0, lim.ry0); ry <= Math.min(ry1, lim.ry1); ry++) {
          for (let rx = Math.max(rx0, lim.rx0); rx <= Math.min(rx1, lim.rx1); rx++) {
            const ch = getRegion(B, st, F, z, rx, ry, SS);
            if (!ch) {
              statsInfo.direct++;
              drawRegionDirect(ctx, B, st, F, z, rx, ry);
              continue;
            }
            if (!ch.c) continue;
            // só a parte com conteúdo e dentro do ecrã (k ≠ 1 só durante um zoom)
            const X0 = rx * RW * S + F.ox, Y0 = (ry * RH - z * 48) * S + F.oy, b = ch.box, k = S / SS;
            const sx0 = Math.max(b[0], Math.floor(-X0 / k)), sy0 = Math.max(b[1], Math.floor(-Y0 / k));
            const sx1 = Math.min(b[2], Math.ceil((F.W - X0) / k)), sy1 = Math.min(b[3], Math.ceil((F.H - Y0) / k));
            if (sx1 <= sx0 || sy1 <= sy0) continue;
            if (k === 1) {
              ctx.imageSmoothingEnabled = false; // cópia 1:1 alinhada ao píxel: sem filtragem
              ctx.drawImage(ch.c, sx0, sy0, sx1 - sx0, sy1 - sy0, X0 + sx0, Y0 + sy0, sx1 - sx0, sy1 - sy0);
              ctx.imageSmoothingEnabled = true;
            } else ctx.drawImage(ch.c, sx0, sy0, sx1 - sx0, sy1 - sy0, X0 + sx0 * k, Y0 + sy0 * k, (sx1 - sx0) * k, (sy1 - sy0) * k);
            statsInfo.chunks++;
          }
        }
      }
      if (OV.FX && OV.FX.drawDecals) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, F.te, F.tf);
        OV.FX.drawDecals(ctx, { x: F.cam.x - F.sh.x / F.zoom, y: F.cam.y - F.sh.y / F.zoom, zoom: F.zoom }, z);
        ctx.restore();
      }
      drawReach(ctx, B, F, z);
      if (hover && hover.z === z) {
        cursorBack(ctx, F, (hover.x - hover.y) * 32 * S + F.ox, ((hover.x + hover.y) * 16 - z * 48) * S + F.oy, mode);
      }
      if (view.nodes && B.nodes) {
        for (const nd of B.nodes) {
          if (nd.z !== z) continue;
          const X = (nd.x - nd.y) * 32 * S + F.ox, Y = ((nd.x + nd.y) * 16 - z * 48 + 16) * S + F.oy;
          ctx.fillStyle = css(RANK_COL[nd.rank] || 0xffffff, 0.85);
          ctx.fillRect(X - 3 * S, Y - 3 * S, 6 * S, 6 * S);
          smallText(ctx, F, X, Y - 9 * S, String(nd.rank), RANK_COL[nd.rank] || 0xffffff);
        }
      }

      // -- passe 2: varrimento diagonal
      const dmin = Math.floor((wx0 - 40) / 32), dmax = Math.ceil((wx1 + 40) / 32);
      const smin = Math.max(0, Math.floor((wy0 - 40 + z * 48) / 16)), smax = Math.min(m.w + m.h - 2, Math.ceil((wy1 + 76 + z * 48) / 16));
      for (let s = smin; s <= (DBG.noSweep ? -1 : smax); s++) {
        const xa = Math.max(0, s - (m.h - 1), Math.ceil((s + dmin) / 2)), xb = Math.min(m.w - 1, s, Math.floor((s + dmax) / 2));
        for (let x = xa; x <= xb; x++) {
          const y = s - x;
          const i = (z * m.h + y) * m.w + x;
          const b4 = i * 4;
          const X = (x - y) * 32 * S + F.ox, Y = (s * 16 - z * 48) * S + F.oy;
          const disc = F.revealAll ? 7 : m.disc[i];
          const vis = F.allVisible || F.vis[i];
          const lit = F.light[i];
          let dark = 1 - (1 - SHADE_A(15 - lit)) * (vis ? 1 : 1 - FOG_DIM) * (1 - lvlDim);
          if (dark < 0.01) dark = 0;
          const grayA = vis ? 0 : FOG_GRAY;
          const wst = m.parts[b4 + 1], nth = m.parts[b4 + 2];
          let obj = m.parts[b4 + 3];
          if (wst && disc & 2) {
            const spr = tileSpr(st, S, wst, st.variant[i], 0);
            if (spr) { TS.blitDev(ctx, spr, X, Y, S, dark, grayA); statsInfo.sprites++; }
          }
          if (nth && disc & 4) {
            const spr = tileSpr(st, S, nth, st.variant[i], 0);
            if (spr) { TS.blitDev(ctx, spr, X, Y, S, dark, grayA); statsInfo.sprites++; }
          }
          if (!(disc & 1)) continue;
          const items = itemsAt.get(i);
          if (items && OV.ItemSprites) {
            const n = Math.min(3, items.length);
            for (let k = items.length - n; k < items.length; k++) {
              const it = items[k];
              const spr = OV.ItemSprites.ground(it.type, S);
              const j = k - (items.length - n);
              const IX = X + (j - (n - 1) / 2) * 7 * S, IY = Y + (16 + (j & 1) * 3) * S;
              const dx = Math.round(IX - spr.ax * S), dy = Math.round(IY - spr.ay * S);
              ctx.drawImage(spr.c, dx, dy, Math.round(spr.w * S), Math.round(spr.h * S));
              if (dark > 0.05) {
                ctx.globalAlpha = dark * 0.85;
                ctx.fillStyle = css(NIGHT);
                ctx.beginPath();
                ctx.ellipse(IX, IY, 10 * S, 6 * S, 0, 0, TAU);
                ctx.fill();
                ctx.globalAlpha = 1;
              }
              const idef = OV.Data.items[it.type];
              if (idef && idef.light) glows.push({ X: IX, Y: IY, r: 120, col: 0xfff2c0, a: 0.55 });
            }
          }
          if (obj) {
            const od = D[obj];
            let state = 0;
            if (od.door === 'ufo') {
              if (m.ufoDoorOpen[i] && !od.open && od.alt) obj = od.alt;
              state = doorOri(m, x, y, z);
            } else if (TS.frames(obj) > 1) state = animState(obj, st, i, F.time);
            else if (od.diagonal && TS.objectState) state = TS.objectState(m, x, y, z);
            const spr = tileSpr(st, S, obj, st.variant[i], state);
            if (spr) { TS.blitDev(ctx, spr, X, Y, S, dark, grayA); statsInfo.sprites++; }
            const od2 = D[obj];
            if (od2 && od2.light && vis) glows.push({ X, Y: Y + (16 - (od2.height || 12) * 1.4) * S, r: od2.art === 'lamp' ? 150 : 90, col: od2.art === 'lamp' ? 0xffe8a0 : (OV.Data.tilesets[od2.set] || {}).palette.accent || 0x60d0ff, a: 0.4 });
          }
          const ul = unitsAt.get(i);
          if (ul) {
            ul.sort((p, q) => p.fx + p.fy - q.fx - q.fy);
            if (!DBG.noUnits) for (const r of ul) drawUnit(ctx, B, F, st, r, rects, lvlDim, glows);
          }
          if (i === hoverI) cursorFront(ctx, F, X, Y, mode);
          if (m.fire[i] && OV.FX && !DBG.noFire) {
            OV.FX.flame(ctx, X, Y + 20 * S, S, F.time, st.variant[i], Math.min(1.3, 0.6 + m.fire[i] * 0.1));
            glows.push({ X, Y: Y + 8 * S, r: 140, col: 0xff8a30, a: 0.5 });
          }
          if (m.smoke[i] && OV.FX && !DBG.noFire) OV.FX.smokeTile(ctx, X, Y + 14 * S, S, F.time, st.variant[i], m.smoke[i]);
        }
      }
    }

    // clarão do disparo (B.flashes): o tile do atirador fica iluminado até ao próximo turno do seu lado
    for (const f of B.flashes || []) {
      if (!(f.i >= 0 && f.i < m.n) || !(F.allVisible || F.vis[f.i])) continue;
      const [fx, fy, fz] = tileCenterDev(F, m, f.i);
      if (fz > F.viewZ) continue;
      const k = F.still ? 1 : 0.85 + 0.15 * Math.sin(F.time / 90 + f.i);
      glows.push({ X: fx, Y: fy - 20 * S, r: 120, col: f.side === 'alien' ? 0xffc070 : 0xfff0c0, a: 0.75 * k });
    }
    // brilhos aditivos (fogo, very-lights, candeeiros, clarões) — mais fortes de noite
    if (glows.length && !DBG.noGlow) {
      ctx.globalCompositeOperation = 'lighter';
      for (const g of glows) {
        const r = g.r * S * (0.6 + 0.4 * nightK);
        const gr = ctx.createRadialGradient(g.X, g.Y, 0, g.X, g.Y, r);
        const a = g.a * (0.25 + 0.75 * nightK);
        gr.addColorStop(0, css(g.col, a * 0.55));
        gr.addColorStop(0.35, css(g.col, a * 0.22));
        gr.addColorStop(1, css(g.col, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(g.X - r, g.Y - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    drawGhosts(ctx, B, F, rects);
    // barras do selecionado antes das etiquetas (a etiqueta do caminho nunca fica por baixo delas)
    drawSelectedBars(ctx, B, F, rects);
    drawBlips(ctx, B, F);
    drawThrowRange(ctx, B, F);
    drawKbCursor(ctx, B, F);
    drawPath(ctx, B, F);
    drawTarget(ctx, B, F);
    drawBlast(ctx, B, F);
    drawThrow(ctx, B, F);
    drawThrowLabel(ctx, B, F);
    ctx.restore();

    // FX por cima, em px CSS (com o tremor já aplicado na câmara)
    if (OV.FX) {
      ctx.save();
      OV.FX.draw(ctx, { x: F.cam.x - F.sh.x / F.zoom, y: F.cam.y - F.sh.y / F.zoom, zoom: F.zoom }, F.viewZ);
      ctx.restore();
    }

    last = { B, view, rects, F: { ox: F.ox, oy: F.oy, S: F.S, dpr: F.dpr, viewZ: F.viewZ, revealAll: F.revealAll } };
    statsInfo.units = rects.length;
    statsInfo.ms = now() - t0;
  }

  function drawUnit(ctx, B, F, st, r, rects, lvlDim, glows) {
    const US = OV.UnitSprites;
    if (!US) return;
    const u = r.u, a = r.a, S = F.S;
    const X = (r.fx - r.fy) * 32 * S + F.ox, Y = ((r.fx + r.fy) * 16 + 16 - r.fz * 48) * S + F.oy;
    const key = u.sprite || 'soldier';
    let pose = a && a.pose ? a.pose : u.kneel ? 'kneel' : u.float ? 'float' : 'stand';
    let frame = a && a.frame !== undefined ? a.frame : pose === 'float' ? Math.floor(F.time / 160) & 3 : 0;
    if (u.status === 'dead' && !a) pose = 'dead';
    const inf = unitInfo(B, st, u);
    // sombra: luz do próprio tile; a X-COM tem luz pessoal (sombra limitada)
    const lit = F.light[r.ownTile] === undefined ? 15 : F.light[r.ownTile];
    let shadeA = 1 - (1 - SHADE_A(15 - lit)) * (1 - lvlDim);
    // só se desenham inimigos que a X-COM vê: também têm de se ler no escuro (os soldados têm luz pessoal)
    shadeA = Math.min(shadeA, (u.side === 'xcom' ? 0.42 : 0.3) + lvlDim);
    const shadeI = Math.max(0, Math.min(15, Math.round((shadeA / 0.85) * 15)));
    US.drawShadow(ctx, X, Y, r.size, S);
    if (F.view.selectedId === u.id) US.selectionRing(ctx, X, Y, S, PAL.select, r.size);
    else if (u.side === 'alien' && u.status !== 'dead') hostileRing(ctx, X, Y, S, r.size, F);
    const spr = US.get(key, r.dir, pose, frame, S, inf.opts);
    US.blit(ctx, spr, X, Y, S, shadeI, a && a.flash ? a.flash : 0);
    r.spr = spr;
    r.X = X;
    r.Y = Y;
    if (u.burn > 0) {
      if (OV.FX) OV.FX.flame(ctx, X, Y + 2 * S, S * 0.8, F.time, u.id, 0.8);
      glows.push({ X, Y: Y - 10 * S, r: 120, col: 0xff8a30, a: 0.45 });
    }
    // caixa de toque (px CSS)
    const hgt = ((u.kneel ? u.kneelHeight : u.height) || 22) * 2 * F.zoom;
    const cx = X / F.dpr, cy = Y / F.dpr;
    const half = (r.size > 1 ? 26 : 13) * F.zoom;
    rects.push({ x0: cx - half, x1: cx + half, y0: cy - hgt - 6 * F.zoom + (r.size > 1 ? 16 * F.zoom : 0), y1: cy + 8 * F.zoom + (r.size > 1 ? 16 * F.zoom : 0),
      unitId: u.id, x: Math.round(r.fx), y: Math.round(r.fy), z: Math.round(r.fz), X, Y, hgt, friend: u.side === 'xcom' && r.size === 1, yBody: cy - hgt * 0.55,
      rec: r, hostile: u.side === 'alien' && u.status !== 'dead' });
  }

  const tileOfRec = (B, r) => (Math.round(r.fz) * B.map.h + Math.round(r.fy)) * B.map.w + Math.round(r.fx);
  // há parede ou objeto alto à frente da unidade (desenhado depois dela, tapa-a)?
  function occluded(B, F, r) {
    const m = B.map, D = OV.Data.tileDefs;
    const s1 = (r.size || 1) - 1;
    const x = Math.round(r.fx) + s1, y = Math.round(r.fy) + s1, z = Math.round(r.fz);
    const at = (tx, ty) => (tx < m.w && ty < m.h ? (z * m.h + ty) * m.w + tx : -1);
    const disc = (i) => F.revealAll || m.disc[i];
    for (const [tx, ty] of [[x + 1, y], [x, y + 1], [x + 1, y + 1], [x + 2, y + 1], [x + 1, y + 2]]) {
      const i = at(tx, ty);
      if (i < 0) continue;
      const o = m.parts[i * 4 + 3];
      if (o && D[o] && (D[o].fullBlock || (D[o].height | 0) >= 12) && disc(i) & 1) return true;
    }
    for (const [tx, ty, part] of [[x + 1, y, 1], [x + 1, y + 1, 1], [x, y + 1, 2], [x + 1, y + 1, 2]]) {
      const i = at(tx, ty);
      if (i < 0) continue;
      const w = m.parts[i * 4 + part];
      if (w && D[w] && !D[w].open && disc(i) & (part === 1 ? 2 : 4)) return true;
    }
    return false;
  }
  // unidades visíveis escondidas atrás de paredes: silhueta transparente por cima de tudo + marca de inimigo
  function drawGhosts(ctx, B, F, rects) {
    const US = OV.UnitSprites;
    for (const q of rects) {
      const r = q.rec;
      if (!r || !r.spr || !US) continue;
      if (occluded(B, F, r)) {
        // o soldado selecionado (quem dispara) e o alvo apontado veem-se melhor através das paredes, com o anel
        const sel = q.unitId === F.view.selectedId;
        const tgt = !!F.view.target && F.view.target.toI >= 0 && q.hostile && q.rec && tileOfRec(B, q.rec) === F.view.target.toI;
        ctx.save();
        ctx.globalAlpha = sel || tgt ? 0.72 : 0.42;
        if (sel) US.selectionRing(ctx, r.X, r.Y, F.S, PAL.select, r.size);
        US.blit(ctx, r.spr, r.X, r.Y, F.S, 0, 0);
        ctx.restore();
      }
      if (q.hostile) hostileChevron(ctx, F, q);
    }
  }
  // seta para baixo por cima da cabeça de um inimigo à vista (forma própria: não depende da cor)
  function hostileChevron(ctx, F, q) {
    const d = F.dpr, S = F.S;
    const X = q.X, Y = q.Y - q.hgt * d - (q.rec && q.rec.size > 1 ? -4 : 8) * S - 6 * d;
    const w = Math.max(5 * d, 7 * S), h = Math.max(5 * d, 7 * S);
    const bob = F.still ? 0 : Math.sin(F.time / 260) * 1.5 * d;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X - w, Y - h + bob);
    ctx.lineTo(X + w, Y - h + bob);
    ctx.lineTo(X, Y + bob);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * d;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.stroke();
    ctx.fillStyle = css(PAL.target);
    ctx.fill();
    ctx.lineWidth = 1.2 * d;
    ctx.strokeStyle = css(0xffffff, 0.85);
    ctx.stroke();
    ctx.restore();
  }

  // marca de inimigo à vista: losango (não a elipse dos soldados) com cantos salientes, aos pés
  function hostileRing(ctx, X, Y, S, size, F) {
    const big = size > 1, rx = (big ? 34 : 17) * S, ry = rx / 2, cy = Y + (big ? 16 * S : 0);
    const pts = [[X, cy - ry], [X + rx, cy], [X, cy + ry], [X - rx, cy]];
    ctx.save();
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.lineWidth = Math.max(1, 3.2 * S);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.setLineDash([Math.max(2, 5 * S), Math.max(2, 3 * S)]);
    ctx.lineWidth = Math.max(1, 1.6 * S);
    ctx.strokeStyle = css(PAL.target, F.still ? 0.85 : 0.72 + 0.15 * Math.sin(F.time / 300));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(1, 2.4 * S);
    ctx.strokeStyle = css(PAL.target);
    ctx.beginPath();
    for (const [px, py] of pts) {
      ctx.moveTo(px + (px - X) * 0.18, py + (py - cy) * 0.18);
      ctx.lineTo(px - (px - X) * 0.1, py - (py - cy) * 0.1);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawSelectedBars(ctx, B, F, rects) {
    const id = F.view.selectedId;
    if (id === null || id === undefined) return;
    const r = rects.find((q) => q.unitId === id);
    if (!r) return;
    const u = OV.BUnits && OV.BUnits.findUnit ? OV.BUnits.findUnit(B, id) : B.units.find((q) => q.id === id);
    if (!u) return;
    const d = F.dpr, w = 30 * d, h = 3 * d;
    const x0 = Math.round(r.X - w / 2), y0 = Math.round(r.Y - r.hgt * d - 14 * d);
    const bar = (y, frac, col, frac2, col2) => {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x0 - d, y - d, w + 2 * d, h + 2 * d);
      ctx.fillStyle = css(col);
      ctx.fillRect(x0, y, Math.round(w * Math.max(0, Math.min(1, frac))), h);
      if (frac2 > 0) {
        ctx.fillStyle = css(col2, 0.85);
        ctx.fillRect(x0, y, Math.round(w * Math.max(0, Math.min(1, frac2))), h);
      }
    };
    bar(y0, u.tuMax ? u.tu / u.tuMax : 0, PAL.tu, 0, 0);
    bar(y0 + h + 3 * d, u.hpMax ? u.hp / u.hpMax : 0, PAL.hp, u.hpMax ? Math.min(u.hp, u.stun || 0) / u.hpMax : 0, PAL.stun);
  }

  function voxDev(F, v) {
    const p = Array.isArray(v) || ArrayBuffer.isView(v) ? v : [v.vx !== undefined ? v.vx : v.x, v.vy !== undefined ? v.vy : v.y, v.vz !== undefined ? v.vz : v.z];
    const tx = p[0] / 16, ty = p[1] / 16, tz = p[2] / 24;
    return [(tx - ty) * 32 * F.S + F.ox, ((tx + ty) * 16 - tz * 48) * F.S + F.oy];
  }
  function tileCenterDev(F, m, i) {
    const plane = m.w * m.h;
    const z = (i / plane) | 0, r = i - z * plane, y = (r / m.w) | 0, x = r - y * m.w;
    return [(x - y) * 32 * F.S + F.ox, ((x + y) * 16 + 16 - z * 48) * F.S + F.oy, z];
  }

  function drawPath(ctx, B, F) {
    const P = F.view.path;
    if (!P || !P.steps || !P.steps.length) return;
    const m = B.map, d = F.dpr;
    const pts = P.steps.map((s) => tileCenterDev(F, m, s.i));
    const sel = F.view.selectedId !== undefined && F.view.selectedId !== null && OV.BUnits ? OV.BUnits.findUnit(B, F.view.selectedId) : null;
    const startPt = sel ? [(sel.x - sel.y) * 32 * F.S + F.ox, ((sel.x + sel.y) * 16 + 16 - sel.z * 48) * F.S + F.oy] : null;
    // linha de ligação: cheia onde a reserva fica intacta, tracejada onde a come, nenhuma até casas inalcançáveis
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let k = 0; k < (P.noLine ? 0 : pts.length); k++) {
      const p = pts[k];
      const prev = k ? pts[k - 1] : startPt;
      const state = P.steps[k].state;
      if (!prev || state === 'out') continue;
      const col = PAL[state] || PAL.ok;
      ctx.setLineDash(state === 'reserve' ? [5 * d, 4 * d] : []);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 4 * d;
      ctx.beginPath();
      ctx.moveTo(prev[0], prev[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.strokeStyle = css(col, 0.8);
      ctx.lineWidth = 2 * d;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], s = P.steps[k];
      const col = PAL[s.state] || PAL.ok;
      const lastStep = k === pts.length - 1;
      const r = (lastStep ? 5 : 3.5) * d;
      if (s.state === 'out') {
        // ✕ onde as UT não chegam
        const q = r * 1.25;
        ctx.lineCap = 'round';
        for (const [w, c] of [[4.2 * d, 'rgba(0,0,0,0.75)'], [2.2 * d, css(col)]]) {
          ctx.lineWidth = w;
          ctx.strokeStyle = c;
          ctx.beginPath();
          ctx.moveTo(p[0] - q, p[1] - q * 0.6);
          ctx.lineTo(p[0] + q, p[1] + q * 0.6);
          ctx.moveTo(p[0] + q, p[1] - q * 0.6);
          ctx.lineTo(p[0] - q, p[1] + q * 0.6);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.ellipse(p[0], p[1], r * 1.4, r * 0.8, 0, 0, TAU);
        if (s.state === 'reserve') {
          // ponto oco: chega lá, mas gasta as UT guardadas para disparar
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fill();
          ctx.lineWidth = 1.8 * d;
          ctx.strokeStyle = css(col);
          ctx.stroke();
        } else {
          ctx.fillStyle = css(col);
          ctx.fill();
          ctx.lineWidth = d;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.stroke();
        }
      }
      // barra onde a reserva começa a ser comida
      const prevState = k ? P.steps[k - 1].state : 'ok';
      if (s.state === 'reserve' && prevState === 'ok' && !P.noLine) {
        const q = k ? pts[k - 1] : startPt;
        if (q) {
          const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, ang = Math.atan2(p[1] - q[1], p[0] - q[0]) + Math.PI / 2;
          const L = 7 * d, cx = Math.cos(ang) * L, cy = Math.sin(ang) * L;
          for (const [w, c] of [[4.5 * d, 'rgba(0,0,0,0.75)'], [2.4 * d, css(PAL.reserve)]]) {
            ctx.lineWidth = w;
            ctx.strokeStyle = c;
            ctx.beginPath();
            ctx.moveTo(mx - cx, my - cy);
            ctx.lineTo(mx + cx, my + cy);
            ctx.stroke();
          }
        }
      }
      if (s.tu !== undefined && s.tu !== null) smallText(ctx, F, p[0], p[1] - 10 * d, String(s.tu), col);
    }
    if (P.lock) {
      // destino à espera de confirmação: losango a pulsar (fixo com movimento reduzido)
      const p = pts[pts.length - 1];
      const k = F.still ? 0.8 : 0.5 + 0.5 * Math.sin(F.time / 140);
      const X = p[0], Y = p[1] - 16 * F.S;
      diamond(ctx, X, Y, F.S, 1 - k * 3);
      ctx.lineWidth = Math.max(1, (F.still ? 3 : 2) * d);
      ctx.strokeStyle = css(PAL[P.steps[pts.length - 1].state] || PAL.ok, 0.5 + 0.5 * k);
      ctx.stroke();
    }
    if (P.label) {
      // etiqueta do lado oposto ao caminho que chega (não tapa os números dos passos)
      const p = pts[pts.length - 1];
      const q = pts.length > 1 ? pts[pts.length - 2] : startPt;
      const below = !!q && q[1] < p[1] - 2 * d;
      const ly = below ? p[1] + 20 * d + 8 * F.S : p[1] - 22 * d - 18 * F.S;
      const col = PAL[P.steps[pts.length - 1].state] || PAL.ok;
      pill(ctx, F, p[0], ly, String(P.label), col);
      if (P.sub) pill(ctx, F, p[0], ly + (below ? 1 : -1) * 24 * d * F.ts, String(P.sub), typeof P.subCol === 'string' ? PAL[P.subCol] || 0xc8d2dc : 0xc8d2dc);
    }
  }

  // cursor de teclado: losango branco sobre preto (contraste máximo em qualquer chão) com cantos
  function drawKbCursor(ctx, B, F) {
    const K = F.view.kcur;
    if (!K || K.z > F.viewZ) return;
    const S = F.S, d = F.dpr;
    const X = (K.x - K.y) * 32 * S + F.ox, Y = ((K.x + K.y) * 16 - K.z * 48) * S + F.oy;
    const k = F.still ? 1 : 0.75 + 0.25 * Math.sin(F.time / 180);
    ctx.save();
    diamond(ctx, X, Y, S, 0);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5 * d;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.stroke();
    ctx.lineWidth = 2.4 * d;
    ctx.strokeStyle = css(0xffffff, k);
    ctx.stroke();
    ctx.fillStyle = css(0xffffff, 0.1);
    ctx.fill();
    // cantos para fora (lê-se mesmo por cima do contorno do alcance)
    const pts = [[X, Y], [X + 32 * S, Y + 16 * S], [X, Y + 32 * S], [X - 32 * S, Y + 16 * S]];
    ctx.lineCap = 'round';
    for (const [w, c] of [[5 * d, 'rgba(0,0,0,0.85)'], [2.4 * d, css(0xffffff)]]) {
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.beginPath();
      for (const [px, py] of pts) {
        const ox = (px - X) * 0.22, oy = (py - (Y + 16 * S)) * 0.22;
        ctx.moveTo(px + ox * 0.2, py + oy * 0.2);
        ctx.lineTo(px + ox, py + oy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTarget(ctx, B, F) {
    const T = F.view.target;
    if (!T) return;
    const m = B.map, d = F.dpr;
    const col = T.blocked ? PAL.out : PAL.target;
    if (T.line && T.line.length > 1) {
      const pts = T.line.map((v) => voxDev(F, v));
      ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3.5 * d;
      ctx.stroke();
      ctx.setLineDash([6 * d, 4 * d]);
      ctx.lineDashOffset = F.still ? 0 : -((F.time / 40) % (10 * d));
      ctx.strokeStyle = css(T.blocked ? PAL.out : 0xffe0a0, 0.95);
      ctx.lineWidth = 1.6 * d;
      ctx.stroke();
      ctx.setLineDash([]);
      // rota da bomba guiada: marca cada casa por onde passa
      if (T.route) {
        ctx.fillStyle = css(0xffe0a0, 0.95);
        for (let k = 1; k < pts.length - 1; k++) {
          ctx.beginPath();
          ctx.arc(pts[k][0], pts[k][1], 2.4 * d, 0, TAU);
          ctx.fill();
        }
      }
    }
    if (T.blockI !== undefined && T.blockI !== null && T.blockI >= 0 && T.blockI < m.n) {
      // o que tapa o tiro (objeto, parede): losango vermelho nesse tile
      const [bx, by, bz] = tileCenterDev(F, m, T.blockI);
      if (bz <= F.viewZ) {
        diamond(ctx, bx, by - 16 * F.S, F.S, 2);
        ctx.fillStyle = css(PAL.out, 0.2);
        ctx.fill();
        ctx.lineWidth = Math.max(1, 1.6 * d);
        ctx.strokeStyle = css(PAL.out, 0.9);
        ctx.stroke();
      }
    }
    if (T.toI === undefined || T.toI === null || T.toI < 0) return;
    const [X, Y] = tileCenterDev(F, m, T.toI);
    const r = 18 * F.S;
    ctx.lineWidth = Math.max(1, 1.6 * d);
    ctx.strokeStyle = css(col, 0.95);
    ctx.beginPath();
    ctx.ellipse(X, Y - 18 * F.S, r * 0.6, r * 0.6, 0, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      ctx.moveTo(X + dx * r * 0.35, Y - 18 * F.S + dy * r * 0.35);
      ctx.lineTo(X + dx * r * 0.85, Y - 18 * F.S + dy * r * 0.85);
    }
    ctx.stroke();
    if (T.blocked) {
      ctx.lineWidth = 3 * d;
      ctx.beginPath();
      ctx.moveTo(X - 7 * d, Y - 18 * F.S - 7 * d);
      ctx.lineTo(X + 7 * d, Y - 18 * F.S + 7 * d);
      ctx.moveTo(X + 7 * d, Y - 18 * F.S - 7 * d);
      ctx.lineTo(X - 7 * d, Y - 18 * F.S + 7 * d);
      ctx.stroke();
    }
    const label = T.label !== undefined && T.label !== null ? String(T.label) : T.hitPct !== undefined && T.hitPct !== null ? (T.hitPct | 0) + '%' : null;
    /* ao lado do alvo, alinhadas pela aresta (nunca centradas na coluna da unidade), do lado oposto ao atirador para
       não taparem quem dispara nem a linha de tiro; sem espaço desse lado → o outro */
    const gap = Math.max(26 * d, 24 * F.S);
    const wMax = Math.max(label ? pillSize(ctx, F, label).w : 0, T.sub ? pillSize(ctx, F, String(T.sub)).w : 0);
    const box = safeBox(F);
    const side = labelSide(B, F, T, X, Y, gap, wMax, box);
    const right = side.right;
    const ly = side.ly;
    const lx = right ? X + gap : X - gap, al = right ? 'left' : 'right';
    // onde ficaram as etiquetas (px CSS; leitura para o QA)
    F.view.targetLabel = { right, x: lx / d, y: ly / d, tx: X / d, ty: Y / d };
    if (label) pill(ctx, F, lx, ly, label, T.blocked ? PAL.out : hitCol(T.hitPct), null, al);
    const subCol = typeof T.subCol === 'string' ? PAL[T.subCol] || PAL.out : T.subCol || PAL.reserve;
    if (T.sub) pill(ctx, F, lx, ly + 24 * d * F.ts, String(T.sub), subCol, null, al);
  }
  /* lado das etiquetas do alvo: o oposto ao atirador (no ecrã); com o atirador quase na mesma coluna, o lado com
     espaço e as etiquetas por baixo do alvo quando o atirador está por cima (pura: só lê B e a vista) */
  function labelSide(B, F, T, X, Y, gap, wMax, box) {
    const fitsR = X + gap + wMax <= box.x1, fitsL = X - gap - wMax >= box.x0;
    let right = fitsR, ly = Y - 36 * F.S;
    const u = T.fromId !== undefined && T.fromId !== null && OV.BUnits ? OV.BUnits.findUnit(B, T.fromId) : null;
    if (u && u.x >= 0) {
      const [ux, uy] = tileCenterDev(F, B.map, (u.z * B.map.h + u.y) * B.map.w + u.x);
      const dx = ux - X;
      if (Math.abs(dx) > 8 * F.S) right = dx < 0 ? fitsR || !fitsL : !fitsL && fitsR;
      // atirador por cima e quase na vertical: etiquetas abaixo do alvo (a linha de tiro chega por cima)
      if (Math.abs(dx) < 40 * F.S && uy < Y - 16 * F.S) ly = Y + 14 * F.S;
    }
    return { right, ly };
  }
  // cor da etiqueta pela probabilidade (vermelho → âmbar → verde)
  function hitCol(p) {
    if (p === null || p === undefined) return PAL.target;
    return p >= 60 ? PAL.ok : p >= 30 ? PAL.reserve : PAL.target;
  }

  // anel de alcance do arremesso (elipse isométrica à volta da unidade)
  function drawThrowRange(ctx, B, F) {
    const R = F.view.throwRange;
    if (!R || !(R.r > 0)) return;
    const d = F.dpr, S = F.S;
    const X = (R.x - R.y) * 32 * S + F.ox, Y = ((R.x + R.y) * 16 + 16 - R.z * 48) * S + F.oy;
    const rx = R.r * 32 * Math.SQRT2 * S, ry = R.r * 16 * Math.SQRT2 * S;
    ctx.save();
    ctx.setLineDash([7 * d, 6 * d]);
    ctx.lineDashOffset = F.still ? 0 : -((F.time / 60) % (13 * d));
    ctx.lineWidth = 3 * d;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(X, Y, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 1.4 * d;
    ctx.strokeStyle = css(PAL.throw, 0.7);
    ctx.stroke();
    ctx.restore();
  }

  // sinais do detetor de movimento (círculos a pulsar)
  function drawBlips(ctx, B, F) {
    const L = F.view.blips;
    if (!L || !L.length) return;
    const d = F.dpr, S = F.S;
    for (const b of L) {
      const X = (b.x - b.y) * 32 * S + F.ox, Y = ((b.x + b.y) * 16 + 16 - b.z * 48) * S + F.oy;
      const age = Math.max(0, F.time - (b.t0 || 0));
      const a = Math.max(0, 1 - age / 4000);
      for (let k = 0; k < 2; k++) {
        const ph = ((age / 900 + k * 0.5) % 1);
        const r = (8 + ph * (14 + 4 * (b.size || 1))) * S;
        ctx.beginPath();
        ctx.ellipse(X, Y, r * 1.4, r * 0.7, 0, 0, TAU);
        ctx.lineWidth = 2 * d;
        ctx.strokeStyle = css(0x58c8ff, a * (1 - ph));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(X, Y, 4 * S, 2 * S, 0, 0, TAU);
      ctx.fillStyle = css(0x58c8ff, a);
      ctx.fill();
    }
  }

  function drawThrow(ctx, B, F) {
    const A = F.view.throwArc;
    if (!A || A.length < 2) return;
    const d = F.dpr;
    const pts = A.map((v) => voxDev(F, v));
    for (let k = 0; k < pts.length; k += Math.max(1, Math.floor(pts.length / 24))) {
      ctx.beginPath();
      ctx.arc(pts[k][0], pts[k][1], 2 * d, 0, TAU);
      ctx.fillStyle = css(PAL.throw, 0.9);
      ctx.fill();
    }
    const e = pts[pts.length - 1];
    const info = F.view.throwInfo;
    const col = info && !info.ok ? PAL.out : PAL.throw;
    ctx.lineWidth = 1.6 * d;
    ctx.strokeStyle = css(col, 0.95);
    ctx.beginPath();
    ctx.ellipse(e[0], e[1], 14 * F.S, 7 * F.S, 0, 0, TAU);
    ctx.stroke();
    if (info && info.toI !== undefined && info.toI !== null && info.toI >= 0) {
      const [X, Y] = tileCenterDev(F, B.map, info.toI);
      diamond(ctx, X, Y - 16 * F.S, F.S, 2);
      ctx.fillStyle = css(col, 0.18);
      ctx.fill();
      ctx.strokeStyle = css(col, 0.9);
      ctx.lineWidth = Math.max(1, 1.4 * d);
      ctx.stroke();
    }
  }
  // etiqueta do arremesso (também sem arco: fora de alcance); segunda etiqueta = aviso (aliados no raio)
  function drawThrowLabel(ctx, B, F) {
    const info = F.view.throwInfo;
    if (!info || !info.label || info.toI === undefined || info.toI === null || info.toI < 0) return;
    const [X, Y] = tileCenterDev(F, B.map, info.toI);
    const ly = Y - 34 * F.dpr - 12 * F.S;
    pill(ctx, F, X, ly, String(info.label), info.ok ? PAL.throw : PAL.out);
    if (info.sub) pill(ctx, F, X, ly - 24 * F.dpr * F.ts, String(info.sub), PAL.out);
  }
  // área da explosão prevista: losango isométrico de raio r tiles (vermelho; fumo a cinzento)
  function drawBlast(ctx, B, F) {
    // granadas ativadas no chão (aviso em Recruta): raio da explosão, sempre visível
    for (const g of F.view.dangers || []) if (g.r > 0 && g.z <= F.viewZ) blastRing(ctx, F, g, PAL.out, true);
    const info = F.view.throwInfo, tg = F.view.target;
    const b = (info && info.blast) || (tg && !tg.blocked && tg.blast);
    if (!b || !(b.r > 0) || b.z > F.viewZ) return;
    blastRing(ctx, F, b, b.smoke ? 0xb8c4cc : b.risk ? PAL.out : PAL.throw, false);
  }
  function blastRing(ctx, F, b, col, danger) {
    const S = F.S, d = F.dpr;
    const X = (b.x - b.y) * 32 * S + F.ox, Y = ((b.x + b.y) * 16 + 16 - b.z * 48) * S + F.oy;
    const rx = (b.r + 0.5) * 32 * Math.SQRT2 * S, ry = (b.r + 0.5) * 16 * Math.SQRT2 * S;
    const pulse = F.still ? 0.6 : 0.5 + 0.5 * Math.sin(F.time / 220);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(X, Y, rx, ry, 0, 0, TAU);
    ctx.fillStyle = css(col, (danger ? 0.12 : 0.07) + 0.05 * pulse);
    ctx.fill();
    if (danger) {
      // contorno escuro + traço cheio: lê-se em qualquer chão e sem depender só da cor
      ctx.lineWidth = 4 * d;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.stroke();
      ctx.lineWidth = 2 * d;
      ctx.strokeStyle = css(col, 0.7 + 0.3 * pulse);
      ctx.stroke();
      // marca ✱ no centro (a granada)
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 4, r = 7 * d;
        ctx.moveTo(X - Math.cos(a) * r, Y - 10 * S - Math.sin(a) * r);
        ctx.lineTo(X + Math.cos(a) * r, Y - 10 * S + Math.sin(a) * r);
      }
      ctx.stroke();
    } else {
      ctx.setLineDash([5 * d, 4 * d]);
      ctx.lineWidth = 1.5 * d;
      ctx.strokeStyle = css(col, 0.75);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- picking, limites e câmara -------------------------------------------------------------------------------
  function pick(view, px, py, Bopt) {
    const B = Bopt || (last && last.B);
    if (!B) return null;
    const m = B.map;
    const cam = view.cam;
    const sh = OV.FX && OV.FX.offset ? OV.FX.offset() : { x: 0, y: 0 };
    if (last && last.B === B) {
      // a mover, a cabeça de um soldado não tapa o tile atrás dele (só o corpo seleciona)
      const moving = !view.cursor || view.cursor === 'move' || view.cursor === 'none';
      for (let k = last.rects.length - 1; k >= 0; k--) {
        const r = last.rects[k];
        const y0 = moving && r.friend ? Math.max(r.y0, r.yBody) : r.y0;
        if (px >= r.x0 && px <= r.x1 && py >= y0 && py <= r.y1) return { x: r.x, y: r.y, z: r.z, unitId: r.unitId };
      }
    }
    const viewZ = Math.max(0, Math.min(m.d - 1, view.viewZ === undefined ? m.d - 1 : view.viewZ | 0));
    const qx = px - sh.x, qy = py - sh.y;
    for (let z = viewZ; z >= 0; z--) {
      const t = OV.Iso.screenToTile(qx, qy, z, cam);
      if (t.x < 0 || t.y < 0 || t.x >= m.w || t.y >= m.h) continue;
      const i = (z * m.h + t.y) * m.w + t.x;
      const ui = B._ && B._.unitAt ? B._.unitAt[i] : 0;
      if (z === 0 || m.parts[i * 4] || ui) return { x: t.x, y: t.y, z, unitId: ui ? ui - 1 : null };
    }
    return null;
  }
  function bounds(B) {
    return OV.Iso.mapBounds(B.map.w, B.map.h, B.map.d);
  }
  function centerOn(view, x, y, z) {
    OV.Iso.centerOn(view.cam, x, y, z || 0, view.w || 1280, view.h || 800);
    return view.cam;
  }
  /* prende a câmara: o centro do ecrã fica sempre sobre o losango do mapa no nível de vista (com 2 tiles de margem).
     A caixa envolvente do losango tem cantos vazios — prender nela deixava o ecrã todo negro. */
  const CAM_PAD = 2;
  function clampCam(view, B) {
    const cam = view.cam, m = B.map, I = OV.Iso;
    const hw = (view.w || 1280) / cam.zoom / 2, hh = (view.h || 800) / cam.zoom / 2;
    const z = Math.max(0, Math.min(m.d - 1, view.viewZ | 0));
    const a = (cam.x + hw) / I.HW, b = (cam.y + hh + z * I.LH) / I.HH; // a = x − y, b = x + y
    const x = Math.max(-CAM_PAD, Math.min(m.w + CAM_PAD, (a + b) / 2));
    const y = Math.max(-CAM_PAD, Math.min(m.h + CAM_PAD, (b - a) / 2));
    cam.x = (x - y) * I.HW - hw;
    cam.y = (x + y) * I.HH - z * I.LH - hh;
    return cam;
  }

  // ---- pré-aquecimento dos sprites de tile ----------------------------------------------------------------------
  /* Depois de carregar uma batalha, os sprites de chão/parede/casco/objeto que o mapa usa são gerados em fotogramas
     ociosos (requestIdleCallback; sem ele setTimeout) à escala atual e às dos zooms vizinhos, com as variantes
     sombreadas mais comuns (sombra ambiente e névoa) à escala atual: o primeiro pan/zoom já não gera centenas de
     sprites num só fotograma. Termina sozinho quando o orçamento de píxeis da cache de sprites fica a 60 %. */
  let warm = null;
  const warmInfo = { total: 0, done: 0, ms: 0, scales: [], finished: true };
  function warmEntries(B, st) {
    const m = B.map, D = OV.Data.tileDefs, TS = OV.TileSprites;
    const count = new Map();
    const add = (def, v, state) => {
      const nv = TS.variants(def) || 1;
      const k = def + '|' + (v % nv) + '|' + state;
      const e = count.get(k);
      if (e) e.n++;
      else count.set(k, { def, v: v % nv, state, n: 1 });
    };
    const plane = m.w * m.h;
    for (let i = 0; i < m.n; i++) {
      const z = (i / plane) | 0, r = i - z * plane, y = (r / m.w) | 0, x = r - y * m.w;
      const v = st.variant[i];
      const f = m.parts[i * 4];
      if (f) add(f, v, floorStateOf(m, x, y, z));
      if (m.parts[i * 4 + 1]) add(m.parts[i * 4 + 1], v, 0);
      if (m.parts[i * 4 + 2]) add(m.parts[i * 4 + 2], v, 0);
      const o = m.parts[i * 4 + 3], od = o && D[o];
      if (!od) continue;
      if (od.door === 'ufo') {
        const ori = doorOri(m, x, y, z);
        add(o, v, ori);
        if (od.alt && !od.open) add(od.alt, v, ori);
      } else if (TS.frames(o) > 1) {
        for (let k = 0; k < TS.frames(o); k++) add(o, v, k);
      } else add(o, v, od.diagonal && TS.objectState ? TS.objectState(m, x, y, z) : 0);
    }
    // os mais frequentes primeiro (o chão dominante, as paredes comuns)
    return Array.from(count.values()).sort((a, b) => b.n - a.n || a.def - b.def || a.v - b.v);
  }
  function warmScales(B, dpr) {
    const z0 = last && last.B === B && last.view && last.view.cam ? last.view.cam.zoom || 1 : 1;
    const zs = ZOOM_STEPS.slice().sort((a, b) => Math.abs(a - z0) - Math.abs(b - z0));
    const out = [];
    for (const z of zs) {
      const S = qS(z * dpr);
      if (out.indexOf(S) < 0) out.push(S);
    }
    return out;
  }
  // sombras típicas deste mapa (ambiente do nível de vista e névoa) para as variantes já compostas
  function warmShades(B) {
    const shade = B.mission && B.mission.shade !== undefined ? B.mission.shade | 0 : 0;
    const amb = SHADE_A(shade);
    const fog = 1 - (1 - amb) * (1 - FOG_DIM);
    const out = [[fog, FOG_GRAY]];
    if (amb > 0.01) out.unshift([amb, 0]);
    return out;
  }
  function scratchCtx() {
    if (!warm.ctx) {
      const c = makeCanvas(1, 1);
      warm.ctx = c.getContext('2d');
    }
    return warm.ctx;
  }
  // um passo do trabalho: um sprite numa escala (+ variantes sombreadas na primeira escala)
  function warmStep(job) {
    const TS = OV.TileSprites;
    if (job.si >= job.scales.length) return false;
    const S = job.scales[job.si];
    if (job.si > 0) {
      const ts = TS.stats ? TS.stats() : null;
      if (ts && ts.pixels > ts.budget * 0.6) return false;
    }
    const e = job.list[job.k];
    const spr = TS.get(e.def, e.v, S, e.state);
    if (spr && job.si === 0) for (const [dark, gray] of job.shades) TS.blitDev(scratchCtx(), spr, -4096, -4096, S, dark, gray);
    warmInfo.done++;
    if (++job.k >= job.list.length) {
      job.k = 0;
      job.si++;
    }
    return true;
  }
  // fatia por chamada: o tempo ocioso que o navegador dá (até 10 ms); sem tempo ocioso (o jogo desenha todos os
  // fotogramas) a chamada vem pelo timeout e faz 5 ms, para o trabalho nunca parar
  const idleCall = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 60 }) : setTimeout(() => fn(null), 32));
  function warmSlice(job, deadline) {
    if (warm !== job) return;
    const t0 = now();
    const idleMs = deadline && typeof deadline.timeRemaining === 'function' && !deadline.didTimeout ? deadline.timeRemaining() - 1 : 0;
    const budget = idleMs > 3 ? Math.min(10, idleMs) : 5;
    let more = warmStep(job);
    while (more && now() - t0 < budget) more = warmStep(job);
    warmInfo.ms += now() - t0;
    if (more) idleCall((d) => warmSlice(job, d));
    else {
      warmInfo.finished = true;
      warm = null;
    }
  }
  /* prewarm(B, {dpr?, scales?, sync?}) → {total}: gera em segundo plano os sprites de tile do mapa (ver acima);
     sync = tudo já (testes). Uma nova chamada (ou reset de outra batalha) cancela a anterior. */
  function prewarm(B, opts) {
    const o = opts || {};
    if (!B || !B.map || !OV.TileSprites || !OV.Data || !OV.Data.tileDefs) return { total: 0 };
    const dpr = o.dpr || (typeof globalThis.devicePixelRatio === 'number' && globalThis.devicePixelRatio > 0 ? globalThis.devicePixelRatio : 1);
    const st = stateOf(B);
    if (!st.dpr) st.dpr = dpr;
    const list = warmEntries(B, st);
    const scales = o.scales || warmScales(B, dpr);
    const job = { B, list, scales, shades: warmShades(B), si: 0, k: 0, ctx: null };
    warm = job;
    Object.assign(warmInfo, { total: list.length * scales.length, done: 0, ms: 0, scales: scales.slice(), finished: false });
    if (!list.length) {
      warmInfo.finished = true;
      warm = null;
    } else if (o.sync) {
      const t0 = now();
      while (warmStep(job));
      warmInfo.ms = now() - t0;
      warmInfo.finished = true;
      warm = null;
    } else idleCall((d) => warmSlice(job, d));
    return { total: warmInfo.total };
  }

  function clearCache() {
    last = null;
    warm = null;
    if (OV.TileSprites) OV.TileSprites.clearCache();
  }
  // nova batalha (ou recarregada): estado de desenho do zero e sprites pré-aquecidos em segundo plano no navegador
  function reset(B) {
    if (!B) return;
    states.delete(B);
    if (typeof document !== 'undefined') prewarm(B);
  }

  OV.BattleRender = {
    draw, pick, bounds, centerOn, clampCam, markDirty, clearCache, reset, prewarm,
    warmStats: () => Object.assign({}, warmInfo, { scales: warmInfo.scales.slice() }),
    stats: () => Object.assign({}, statsInfo),
    // etiquetas (caminho, alvo, arremesso) e caixas das unidades desenhadas no último fotograma, em px CSS
    labels: () => labels.slice(),
    unitRects: () => (last ? last.rects.map((r) => ({ unitId: r.unitId, x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 })) : []),
    setChunkBudget: (px) => { chunkBudget = Math.max(1e5, +px || 48e6); },
    setBakesPerFrame: (n) => { bakesPerFrame = Math.max(1, n | 0); },
    setCanvasFactory: (fn) => { makeCanvas = fn; },
    get REGION() { return [RW, RH]; },
    _debug: DBG,
  };
})(globalThis.OV || (globalThis.OV = {}));
