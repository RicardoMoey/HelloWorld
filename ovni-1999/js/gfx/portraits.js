/* Retratos procedimentais dos soldados (fotografia de identificação militar dos anos 90), sem imagens.
   Tudo deriva de portraitSeed via OV.U.hash32 (sem aleatoriedade do motor): o mesmo soldado tem sempre a mesma cara.
   OV.Portraits.draw(ctx, soldierLike, x, y, size)  desenha num quadrado de size px CSS (canto sup. esq.)
   OV.Portraits.canvas(soldierLike, size) → canvas size×size px no dispositivo (cache LRU)
   OV.Portraits.traits(soldierLike) → traços resolvidos (testes, depuração)
   soldierLike = {portraitSeed, female, nat, armour, rank}; rank 0..5 ou id ('rookie'..'commander');
   armour 'coveralls' | 'personal_armour' | 'power_suit' | 'flying_suit' (outro valor ⇒ coveralls).
   Referencial de desenho: 100×100 unidades, cabeça centrada, ombros a partir de y≈78. */
(function (OV) {
  'use strict';

  const Col = OV.Color;
  const css = Col.css, shade = Col.shade, mix = Col.mix;
  const TAU = Math.PI * 2;
  const RANK_IDS = ['rookie', 'squaddie', 'sergeant', 'captain', 'colonel', 'commander'];

  // ---- paletas ----------------------------------------------------------------------------------------
  const SKINS = [0xf2d6c4, 0xeac4a6, 0xdfb08c, 0xe3bf96, 0xc99b72, 0xb27f57, 0x99673f, 0x7c4f33, 0x5f3a25, 0x48291a];
  const HAIRS = [0x161210, 0x2f1f15, 0x553621, 0x81593a, 0x7a3420, 0xb45a2c, 0xa07e4c, 0xcfae70];
  const GREYS = [0x77736e, 0xa9a49c, 0xd2cec6];
  const EYES = [0x2a1a10, 0x4e3020, 0x6b5a2a, 0x4f6f3a, 0x4a6e9a, 0x6f7c86, 0x7fa3c4];
  const BACKDROPS = [0x5a6b80, 0x617080, 0x56717c, 0x6c7482, 0x667a8c];
  // grupos de nacionalidade → pesos de tons de pele, cabelo e olhos (variedade em todos)
  const NAT_GROUP = {
    pt: 'eus', spain: 'eus', italy: 'eus', france: 'eus', uk: 'eun', germany: 'eun', russia: 'eun',
    usa: 'mix', canada: 'mix', australia: 'mix', brazil: 'br', south_africa: 'za', nigeria: 'af',
    egypt: 'me', india: 'sa', china: 'ea', japan: 'ea',
  };
  const W_SKIN = {
    eun: [16, 26, 22, 8, 10, 6, 4, 3, 3, 2], eus: [6, 16, 24, 14, 18, 10, 5, 3, 2, 2], mix: [10, 16, 16, 8, 12, 10, 8, 8, 7, 5],
    br: [4, 10, 14, 8, 16, 16, 12, 10, 6, 4], za: [6, 10, 8, 4, 8, 10, 12, 16, 14, 12], af: [0, 0, 0, 0, 2, 6, 12, 26, 30, 24],
    ea: [4, 14, 10, 40, 20, 8, 3, 1, 0, 0], sa: [0, 2, 4, 8, 16, 24, 22, 14, 8, 2], me: [2, 6, 12, 12, 22, 22, 14, 6, 3, 1],
  };
  const W_HAIR = {
    eun: [8, 20, 24, 16, 6, 5, 12, 9], eus: [22, 34, 22, 10, 4, 1, 5, 2], mix: [26, 26, 18, 10, 4, 3, 8, 5],
    br: [40, 34, 14, 6, 2, 1, 2, 1], za: [44, 24, 12, 6, 2, 2, 6, 4], af: [72, 26, 2, 0, 0, 0, 0, 0],
    ea: [72, 24, 4, 0, 0, 0, 0, 0], sa: [66, 30, 4, 0, 0, 0, 0, 0], me: [52, 38, 8, 2, 0, 0, 0, 0],
  };
  const W_EYE = {
    eun: [8, 16, 12, 12, 26, 14, 12], eus: [24, 30, 16, 10, 10, 6, 4], mix: [26, 24, 12, 10, 14, 8, 6],
    br: [40, 34, 12, 6, 4, 2, 2], za: [44, 30, 8, 6, 6, 4, 2], af: [70, 28, 2, 0, 0, 0, 0],
    ea: [70, 28, 2, 0, 0, 0, 0], sa: [64, 32, 4, 0, 0, 0, 0], me: [50, 36, 10, 4, 0, 0, 0],
  };
  const EYE_SHAPES = ['almond', 'round', 'narrow', 'hooded', 'monolid'];
  const W_SHAPE = { _: [40, 20, 15, 20, 5], ea: [16, 6, 18, 14, 46] };
  const M_STYLES = ['buzz', 'crew', 'flat', 'side', 'slick', 'curly', 'bald', 'shaved', 'afro'];
  const F_STYLES = ['bun', 'bob', 'pixie', 'pony', 'braid', 'curly', 'afro', 'cornrows'];
  const BERETS = [0x3f78b4, 0x6a1e2a, 0x1e2848, 0x2c4428, 0x18181c, 0x9a8656];
  const W_BERET = [36, 16, 14, 14, 10, 10];
  const HELMETS = [0x4d5a3c, 0x4e5a68, 0x7e7052];
  // fardas por armadura (cores coerentes com OV.UnitSprites)
  const ARM = {
    coveralls: { suit: 0x2f7f9b, collar: 0x3d93af, under: 0x23303a, bulk: 0 },
    personal_armour: { suit: 0x46583f, plate: 0x80996f, collar: 0x384830, bulk: 0.35 },
    power_suit: { suit: 0x4a5772, plate: 0x66748f, trim: 0x8e9bb4, light: 0x7fe4ff, collar: 0x3b4660, bulk: 1 },
    flying_suit: { suit: 0x5a76a2, plate: 0x8fa6c9, trim: 0xc9d4e6, light: 0xffc65a, collar: 0x4a6288, bulk: 0.7 },
  };
  const GOLD = 0xd9b44a, SILVER = 0xc9ced6;

  // ---- sorteio determinístico ---------------------------------------------------------------------------
  function strHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function pickW(u, w) {
    let tot = 0;
    for (const x of w) tot += x;
    let v = u * tot;
    for (let i = 0; i < w.length; i++) {
      v -= w[i];
      if (v < 0 && w[i] > 0) return i;
    }
    for (let i = w.length - 1; i >= 0; i--) if (w[i] > 0) return i;
    return 0;
  }

  function normalize(s) {
    s = s || {};
    const raw = s.portraitSeed !== undefined ? s.portraitSeed : s.seed;
    const seed = typeof raw === 'number' && isFinite(raw) ? raw >>> 0 : strHash(String(raw === undefined ? s.id || s.name || '' : raw));
    let rank = s.rank;
    if (typeof rank === 'string') rank = Math.max(0, RANK_IDS.indexOf(rank));
    rank = Math.max(0, Math.min(5, Math.round(+rank || 0)));
    return {
      seed,
      female: !!s.female,
      nat: typeof s.nat === 'string' ? s.nat : typeof s.nationality === 'string' ? s.nationality : 'pt',
      armour: ARM[s.armour] ? s.armour : 'coveralls',
      rank,
    };
  }

  // traços do retrato (puros: mesma entrada ⇒ mesmo resultado)
  function traits(soldierLike) {
    const n = normalize(soldierLike);
    const seed = n.seed, F = n.female;
    const u = (salt) => OV.U.hash32(seed, salt, 0x51ed27) / 4294967296;
    const grp = NAT_GROUP[n.nat] || 'mix';
    const T = { seed, female: F, nat: n.nat, armour: n.armour, rank: n.rank };
    T.skinIdx = pickW(u(1), W_SKIN[grp]);
    T.skin = SKINS[T.skinIdx];
    let hair = HAIRS[pickW(u(2), W_HAIR[grp])];
    const grey = [0.02, 0.03, 0.08, 0.16, 0.3, 0.42][n.rank];
    if (u(3) < grey) hair = GREYS[Math.floor(u(4) * 3)];
    else if (u(3) < grey * 1.8) hair = mix(hair, GREYS[1], 0.35);
    T.hair = hair;
    T.eye = EYES[pickW(u(5), W_EYE[grp])];
    T.eyeShape = EYE_SHAPES[pickW(u(6), W_SHAPE[grp] || W_SHAPE._)];

    T.dx = (u(7) - 0.5) * 2.4;
    T.fw = F ? 14.2 + u(8) * 2 : 15.2 + u(8) * 2.4;
    T.jaw = F ? 0.52 + u(9) * 0.24 : 0.64 + u(9) * 0.28;
    T.chinW = (F ? 2.6 : 3.4) + u(10) * 3;
    T.faceLen = u(11) * 2.6 - (F ? 1 : 0);
    T.neckW = F ? 6.6 + u(12) * 0.8 : 8.6 + u(12) * 1.2;
    T.eyeSp = 6.3 + u(13) * 1.2;
    T.eyeW = 3.3 + u(14) * 0.6;
    T.eyeTilt = (u(15) - 0.4) * (T.eyeShape === 'monolid' ? 1.6 : 0.9);
    T.gaze = (u(16) - 0.5) * 0.9;
    T.browT = F ? 0.8 + u(17) * 0.7 : 1.2 + u(17) * 1.2;
    T.browArch = u(18) * 1.6;
    T.browIn = (u(19) - 0.5) * 1.6;
    T.browH = u(20) * 1.2;
    T.noseW = (F ? 2.5 : 2.9) + u(21) * 1.4;
    T.noseL = u(22) * 2;
    T.mouthW = (F ? 3.8 : 4.2) + u(23) * 1.4;
    T.lipFull = (F ? 0.5 : 0) + u(24) * 0.8;
    T.expr = ['neutral', 'neutral', 'neutral', 'smile', 'stern', 'neutral'][Math.floor(u(25) * 6)];

    // cabelo: estilos com pesos ajustados ao tipo de cabelo mais provável
    const deep = T.skinIdx >= 7;
    const mW = deep ? [16, 14, 8, 6, 4, 18, 6, 16, 12] : [18, 22, 8, 16, 8, 8, 6, 10, 2];
    const fW = deep ? [18, 10, 10, 10, 10, 12, 14, 16] : [26, 16, 14, 16, 10, 8, 3, 2];
    T.style = F ? F_STYLES[pickW(u(26), fW)] : M_STYLES[pickW(u(26), mW)];
    if (T.style === 'afro' && GREYS.indexOf(T.hair) >= 0) T.style = 'curly';
    T.side = u(27) < 0.5 ? -1 : 1;
    T.hairline = (u(28) - 0.4) * 2.4 + (F ? 0 : n.rank * 0.25);
    T.facial = F ? 'none' : ['none', 'stubble', 'moustache', 'beard', 'goatee'][pickW(u(29), [60, 18, 10, 8, 4])];

    // cobertura de cabeça por patente (fatos blindados: só boina/boné)
    const hw = [
      [['helmet', 22], ['cap', 12]],
      [['helmet', 18], ['cap', 12], ['beret', 10]],
      [['beret', 30], ['helmet', 10], ['cap', 10]],
      [['beret', 40], ['cap', 10], ['peaked', 8]],
      [['beret', 42], ['peaked', 18]],
      [['beret', 30], ['peaked', 40]],
    ][n.rank];
    let hv = u(30) * 100, head = 'none';
    for (const [k, p] of hw) {
      if (hv < p) {
        head = k;
        break;
      }
      hv -= p;
    }
    if (head === 'helmet' && (n.armour === 'power_suit' || n.armour === 'flying_suit')) head = 'none';
    if (head === 'beret' && (T.style === 'afro' || (F && T.style === 'curly'))) head = 'none';
    T.headwear = head;
    T.beret = BERETS[pickW(u(31), W_BERET)];
    T.helmet = HELMETS[Math.floor(u(32) * HELMETS.length)];
    T.glasses = u(33) < 0.07;
    T.scar = u(34) < 0.08 ? (u(35) < 0.5 ? 'brow' : 'cheek') : null;
    T.freckles = T.skinIdx <= 2 && u(36) < 0.22;
    T.lines = n.rank >= 3 && u(37) < 0.65;
    T.backdrop = BACKDROPS[Math.floor(u(38) * BACKDROPS.length)];
    T.grain = OV.U.hash32(seed, 39, 0x51ed27);
    T.headK = 0.95 + u(40) * 0.1;
    return T;
  }

  // ---- auxiliares de desenho ---------------------------------------------------------------------------
  function ellPath(g, cx, cy, rx, ry, rot) {
    g.beginPath();
    g.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU);
  }
  function fillA(g, c, a) {
    g.fillStyle = css(c, a);
    g.fill();
  }
  function strokeA(g, c, w, a) {
    g.lineWidth = w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = css(c, a);
    g.stroke();
  }
  function vgrad(g, y0, y1, c0, c1) {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, css(c0));
    gr.addColorStop(1, css(c1));
    return gr;
  }
  function star(g, x, y, r, c) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i & 1 ? r * 0.42 : r;
      if (i) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = vgrad(g, y - r, y + r, shade(c, 0.35), shade(c, -0.25));
    g.fill();
    strokeA(g, shade(c, -0.6), 0.35, 0.9);
  }
  // insígnia de patente (k = escala)
  function insignia(g, rank, x, y, k) {
    if (rank <= 0) return;
    g.save();
    g.translate(x, y);
    g.scale(k, k);
    const chev = (dy) => {
      g.beginPath();
      g.moveTo(-3, dy + 1.4);
      g.lineTo(0, dy - 1.1);
      g.lineTo(3, dy + 1.4);
      strokeA(g, 0x15120a, 1.9, 0.9);
      strokeA(g, GOLD, 1.1, 1);
    };
    if (rank === 1) chev(0);
    else if (rank === 2) for (const dy of [-1.6, 0, 1.6]) chev(dy);
    else if (rank === 3) {
      for (const dy of [-1.5, 0.7]) {
        g.beginPath();
        g.rect(-2.8, dy - 0.6, 5.6, 1.3);
        g.fillStyle = vgrad(g, dy - 0.6, dy + 0.7, 0xffffff, shade(SILVER, -0.3));
        g.fill();
        strokeA(g, 0x15120a, 0.35, 0.9);
      }
    } else if (rank === 4) star(g, 0, 0, 2.6, GOLD);
    else {
      star(g, -2.4, 0, 2.1, GOLD);
      star(g, 2.4, 0, 2.1, GOLD);
    }
    g.restore();
  }

  // ---- geometria do rosto -------------------------------------------------------------------------------
  function geom(T) {
    const hx = 50 + T.dx, hy = 46;
    return {
      hx, hy,
      top: hy - 26.5,
      chinY: hy + 21.5 + T.faceLen,
      eyeY: hy - 1,
      noseY: hy + 9.4 + T.noseL,
      mouthY: hy + 15 + T.noseL * 0.6 + T.faceLen * 0.3,
    };
  }
  function facePath(g, T, G) {
    const x = G.hx, y = G.hy, w = T.fw, jx = w * (0.5 + T.jaw * 0.5), cw = T.chinW, cy = G.chinY;
    g.beginPath();
    g.moveTo(x, G.top);
    g.bezierCurveTo(x + w * 0.62, G.top, x + w * 1.02, y - 18, x + w, y - 7);
    g.bezierCurveTo(x + w * 1.0, y + 1, x + w * 0.98, y + 6, x + jx, y + 12);
    g.bezierCurveTo(x + jx * 0.82, y + 16.5, x + cw + 2.2, cy - 0.8, x + cw * 0.5, cy);
    g.quadraticCurveTo(x, cy + 0.9, x - cw * 0.5, cy);
    g.bezierCurveTo(x - cw - 2.2, cy - 0.8, x - jx * 0.82, y + 16.5, x - jx, y + 12);
    g.bezierCurveTo(x - w * 0.98, y + 6, x - w * 1.0, y + 1, x - w, y - 7);
    g.bezierCurveTo(x - w * 1.02, y - 18, x - w * 0.62, G.top, x, G.top);
    g.closePath();
  }

  // ---- camadas --------------------------------------------------------------------------------------
  function backdrop(g, T) {
    const B = T.backdrop;
    g.fillStyle = vgrad(g, 0, 100, shade(B, 0.14), shade(B, -0.28));
    g.fillRect(0, 0, 100, 100);
    const rg = g.createRadialGradient(46, 38, 4, 46, 38, 52);
    rg.addColorStop(0, css(mix(B, 0xffffff, 0.22), 0.85));
    rg.addColorStop(1, css(B, 0));
    g.fillStyle = rg;
    g.fillRect(0, 0, 100, 100);
  }

  // tronco: trapézio inclinado desde o pescoço até ombros arredondados; devolve a altura junto ao pescoço
  function shouldersPath(g, T, A, G) {
    const b = A.bulk, nw = T.neckW, x = G.hx;
    const base = 80 - b * 5, sh = 86.5 - b * 6;
    const half = (T.female ? 39 : 45) + b * 4;
    g.beginPath();
    g.moveTo(x - half - 9, 101);
    g.lineTo(x - half - 4, sh + 7);
    g.quadraticCurveTo(x - half - 1, sh - 1.5, x - half + 10, sh - 3.6);
    g.quadraticCurveTo(x - nw - 7, base + 1, x - nw - 1, base - 1.5);
    g.lineTo(x + nw + 1, base - 1.5);
    g.quadraticCurveTo(x + nw + 7, base + 1, x + half - 10, sh - 3.6);
    g.quadraticCurveTo(x + half + 1, sh - 1.5, x + half + 4, sh + 7);
    g.lineTo(x + half + 9, 101);
    g.closePath();
    return base;
  }
  function uniform(g, T, G) {
    const A = ARM[T.armour];
    const top = shouldersPath(g, T, A, G);
    g.fillStyle = vgrad(g, top, 100, shade(A.suit, 0.16), shade(A.suit, -0.32));
    g.fill();
    strokeA(g, shade(A.suit, -0.6), 0.7, 1);
    // luz lateral (esquerda) sobre a farda
    g.save();
    shouldersPath(g, T, A, G);
    g.clip();
    const lg = g.createLinearGradient(0, 0, 100, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0.10)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = lg;
    g.fillRect(0, 60, 100, 40);
    if (T.armour === 'coveralls') {
      // costuras dos ombros e bolsos
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(G.hx + s * 19, top + 0.5);
        g.quadraticCurveTo(G.hx + s * 26, 88, G.hx + s * 28, 101);
        strokeA(g, shade(A.suit, -0.4), 0.6, 0.7);
        g.beginPath();
        g.rect(G.hx + s * 22 - 6, 93, 12, 9);
        strokeA(g, shade(A.suit, -0.35), 0.55, 0.7);
      }
    } else {
      // placas de ombro
      const P = A.plate;
      const ry = 6.5 + A.bulk * 4.5, rx = 11 + A.bulk * 5;
      for (const s of [-1, 1]) {
        const cx = G.hx + s * (32 + A.bulk * 4), cy = top + 6.5 - A.bulk * 0.5;
        ellPath(g, cx, cy, rx, ry, s * 0.18);
        const rg = g.createRadialGradient(cx - rx * 0.4, cy - ry * 0.5, 1, cx, cy, rx);
        rg.addColorStop(0, css(shade(P, 0.42)));
        rg.addColorStop(0.6, css(P));
        rg.addColorStop(1, css(shade(P, -0.42)));
        g.fillStyle = rg;
        g.fill();
        strokeA(g, shade(P, -0.6), 0.7, 1);
        if (A.trim) {
          ellPath(g, cx, cy + 1, rx * 0.72, ry * 0.6, s * 0.18);
          strokeA(g, A.trim, 0.6, 0.6);
        }
      }
      // placa peitoral
      const cw = 15 + A.bulk * 4;
      g.beginPath();
      g.moveTo(G.hx - cw, 86);
      g.lineTo(G.hx + cw, 86);
      g.lineTo(G.hx + cw - 2, 101);
      g.lineTo(G.hx - cw + 2, 101);
      g.closePath();
      g.fillStyle = vgrad(g, 86, 101, shade(P, 0.25), shade(P, -0.3));
      g.fill();
      strokeA(g, shade(P, -0.6), 0.7, 1);
      g.beginPath();
      g.moveTo(G.hx, 87);
      g.lineTo(G.hx, 101);
      strokeA(g, shade(P, -0.5), 0.6, 0.8);
      if (A.trim) {
        g.beginPath();
        g.moveTo(G.hx - cw + 3, 89);
        g.lineTo(G.hx - 3, 89);
        g.moveTo(G.hx + 3, 89);
        g.lineTo(G.hx + cw - 3, 89);
        strokeA(g, A.trim, 0.7, 0.75);
      }
    }
    g.restore();
  }

  function neck(g, T, G) {
    const nw = T.neckW, s = T.skin;
    g.beginPath();
    g.moveTo(G.hx - nw, G.hy + 8);
    g.lineTo(G.hx + nw, G.hy + 8);
    g.lineTo(G.hx + nw + 0.6, 88);
    g.lineTo(G.hx - nw - 0.6, 88);
    g.closePath();
    const lg = g.createLinearGradient(G.hx - nw, 0, G.hx + nw, 0);
    lg.addColorStop(0, css(shade(s, -0.2)));
    lg.addColorStop(0.35, css(shade(s, -0.04)));
    lg.addColorStop(1, css(shade(s, -0.34)));
    g.fillStyle = lg;
    g.fill();
    strokeA(g, shade(s, -0.55), 0.6, 0.8);
    // sombra do queixo
    g.save();
    g.clip();
    ellPath(g, G.hx + 0.6, G.chinY + 1.2, T.fw * 0.72, 4.6);
    fillA(g, shade(s, -0.5), 0.5);
    if (!T.female) {
      ellPath(g, G.hx - 0.4, G.chinY + 7.5, 1.6, 2.4);
      fillA(g, shade(s, 0.15), 0.35);
    }
    g.restore();
  }

  function collar(g, T, G) {
    const A = ARM[T.armour], nw = T.neckW, x = G.hx;
    if (T.armour === 'coveralls') {
      // t-shirt por baixo e abertura em V
      g.beginPath();
      g.moveTo(x - nw - 1.5, 80);
      g.quadraticCurveTo(x, 86.5, x + nw + 1.5, 80);
      g.lineTo(x + 2.6, 93.4);
      g.lineTo(x - 2.6, 93.4);
      g.closePath();
      g.fillStyle = vgrad(g, 80, 96, shade(A.under, 0.15), shade(A.under, -0.3));
      g.fill();
      g.beginPath();
      g.moveTo(x - nw - 1.2, 80.6);
      g.quadraticCurveTo(x, 87, x + nw + 1.2, 80.6);
      strokeA(g, shade(A.under, 0.3), 0.8, 0.9);
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(x + s * (nw + 0.5), 78.4);
        g.lineTo(x + s * (nw + 9.5), 81.8);
        g.lineTo(x + s * 4, 95);
        g.lineTo(x + s * 0.7, 92.8);
        g.lineTo(x + s * (nw + 1.6), 80.6);
        g.closePath();
        g.fillStyle = vgrad(g, 78, 98, shade(A.collar, 0.22), shade(A.collar, -0.3));
        g.fill();
        strokeA(g, shade(A.collar, -0.6), 0.6, 1);
      }
      g.beginPath();
      g.moveTo(x, 93);
      g.lineTo(x, 101);
      strokeA(g, shade(A.suit, -0.55), 0.9, 0.9);
      // fita de nome (traços ilegíveis) e emblema de ombro
      const tx = x - 30;
      g.beginPath();
      g.rect(tx, 90.5, 15, 3.6);
      g.fillStyle = css(0xd9d3be);
      g.fill();
      strokeA(g, 0x5a5444, 0.4, 0.9);
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.moveTo(tx + 1.4 + i * 2.6, 92.3);
        g.lineTo(tx + 3.1 + i * 2.6, 92.3);
        strokeA(g, 0x2a2a2a, 0.9, 0.75);
      }
      patch(g, x + 32, 87);
      insignia(g, T.rank, x - 7.4, 88.2, 0.95);
      insignia(g, T.rank, x + 7.4, 88.2, 0.95);
      return;
    }
    // colarinho almofadado (armadura pessoal) ou anel de vedação (fatos energético/voador)
    const ring = A.bulk >= 0.7, base = 80 - A.bulk * 5;
    if (ring) {
      const rt = base - 6, rw = nw + 5;
      g.beginPath();
      g.moveTo(x - rw, base + 5);
      g.lineTo(x - rw + 0.6, rt + 2);
      g.quadraticCurveTo(x, rt - 1.5, x + rw - 0.6, rt + 2);
      g.lineTo(x + rw, base + 5);
      g.quadraticCurveTo(x, base + 9.5, x - rw, base + 5);
      g.closePath();
      g.fillStyle = vgrad(g, rt, base + 9, shade(A.plate, 0.05), shade(A.plate, -0.45));
      g.fill();
      strokeA(g, shade(A.collar, -0.65), 0.7, 1);
      g.beginPath();
      g.moveTo(x - rw + 1.2, rt + 2.6);
      g.quadraticCurveTo(x, rt - 0.6, x + rw - 1.2, rt + 2.6);
      strokeA(g, A.trim, 0.7, 0.8);
      g.beginPath();
      g.moveTo(x - rw + 2.4, rt + 6.6);
      g.quadraticCurveTo(x, rt + 4.2, x + rw - 2.4, rt + 6.6);
      strokeA(g, A.light, 1.1, 0.9);
      strokeA(g, 0xffffff, 0.4, 0.6);
    } else {
      g.beginPath();
      g.moveTo(x - nw - 6.5, base + 0.5);
      g.quadraticCurveTo(x, base + 9.5, x + nw + 6.5, base + 0.5);
      strokeA(g, shade(A.collar, -0.6), 6, 1);
      strokeA(g, A.collar, 4.6, 1);
      g.beginPath();
      g.moveTo(x - nw - 5.5, base - 0.4);
      g.quadraticCurveTo(x, base + 7.8, x + nw + 5.5, base - 0.4);
      strokeA(g, shade(A.collar, 0.35), 0.9, 0.55);
    }
    // insígnia sobre um remendo escuro no peito
    if (T.rank > 0) {
      const px = x - 14 - A.bulk * 2, py = 92;
      g.beginPath();
      g.rect(px - 4.6, py - 3.4, 9.2, 6.8);
      g.fillStyle = css(shade(A.suit, -0.45));
      g.fill();
      strokeA(g, shade(A.suit, -0.7), 0.4, 1);
      insignia(g, T.rank, px, py, 1);
    }
    patch(g, x + 15 + A.bulk * 2, 92);
  }
  // emblema da organização: globo estilizado
  function patch(g, x, y) {
    ellPath(g, x, y, 3.6, 3.6);
    g.fillStyle = css(0x1a2430);
    g.fill();
    strokeA(g, 0xf0a030, 0.8, 1);
    ellPath(g, x, y, 2.2, 2.2);
    strokeA(g, 0x35c4bf, 0.45, 0.9);
    g.beginPath();
    g.moveTo(x - 2.2, y);
    g.lineTo(x + 2.2, y);
    g.moveTo(x, y - 2.2);
    g.lineTo(x, y + 2.2);
    strokeA(g, 0x35c4bf, 0.4, 0.8);
  }

  function ears(g, T, G) {
    const s = T.skin;
    for (const sd of [-1, 1]) {
      const ex = G.hx + sd * (T.fw - 0.4), ey = G.hy + 1.6;
      ellPath(g, ex, ey, 2.9, 5.2, sd * 0.12);
      g.fillStyle = vgrad(g, ey - 5, ey + 5, shade(s, -0.04), shade(s, -0.28));
      g.fill();
      strokeA(g, shade(s, -0.55), 0.55, 0.8);
      ellPath(g, ex + sd * 0.6, ey, 1.2, 3, sd * 0.12);
      strokeA(g, shade(s, -0.4), 0.6, 0.55);
    }
  }

  function face(g, T, G) {
    const s = T.skin;
    facePath(g, T, G);
    g.fillStyle = css(s);
    g.fill();
    g.save();
    facePath(g, T, G);
    g.clip();
    // luz de estúdio (flash, cima-esquerda) e sombras laterais
    const rg = g.createRadialGradient(G.hx - T.fw * 0.32, G.hy - 7, 1, G.hx - T.fw * 0.1, G.hy, T.fw * 1.9);
    rg.addColorStop(0, css(shade(s, 0.16), 0.9));
    rg.addColorStop(0.45, css(s, 0));
    rg.addColorStop(1, css(shade(s, -0.4), 0.8));
    g.fillStyle = rg;
    g.fillRect(G.hx - 30, G.top - 4, 60, 56);
    const lg = g.createLinearGradient(G.hx, 0, G.hx + T.fw, 0);
    lg.addColorStop(0, css(shade(s, -0.3), 0));
    lg.addColorStop(1, css(shade(s, -0.35), 0.35));
    g.fillStyle = lg;
    g.fillRect(G.hx, G.top, T.fw + 2, 52);
    // maçãs do rosto e órbitas
    for (const sd of [-1, 1]) {
      ellPath(g, G.hx + sd * T.fw * 0.58, G.hy + 6.4, 4.4, 2.6);
      fillA(g, mix(s, 0xc85a60, 0.4), 0.1);
      ellPath(g, G.hx + sd * T.eyeSp, G.eyeY - 0.4, T.eyeW + 1.8, 3.4);
      fillA(g, shade(s, -0.3), 0.22);
    }
    for (const sd of [-1, 1]) {
      ellPath(g, G.hx + sd * T.fw * 0.66, G.hy + 10.5, 3.2, 5.2, sd * -0.25);
      fillA(g, shade(s, -0.35), 0.1);
      ellPath(g, G.hx + sd * T.fw * 0.92, G.hy - 9, 3, 6);
      fillA(g, shade(s, -0.35), 0.14);
    }
    // brilho do flash na testa e na cana do nariz
    ellPath(g, G.hx - 2.4, G.hy - 13, 5.4, 2.8, -0.1);
    fillA(g, 0xffffff, 0.08);
    g.restore();
    facePath(g, T, G);
    strokeA(g, shade(s, -0.58), 0.7, 0.9);
  }

  function eye(g, T, G, sd) {
    const ex = G.hx + sd * T.eyeSp, ey = G.eyeY;
    const sh = T.eyeShape;
    const w = T.eyeW * (sh === 'round' ? 0.94 : sh === 'monolid' || sh === 'narrow' ? 1.06 : 1);
    const up = sh === 'round' ? 2.5 : sh === 'narrow' ? 1.6 : sh === 'monolid' ? 1.65 : sh === 'hooded' ? 1.9 : 2.15;
    const dn = sh === 'round' ? 1.9 : sh === 'narrow' ? 1.1 : 1.4;
    const ix = ex - sd * w, iy = ey + 0.25, ox = ex + sd * w, oy = ey - T.eyeTilt;
    const outline = () => {
      g.beginPath();
      g.moveTo(ix, iy);
      g.quadraticCurveTo(ex - sd * 0.3, ey - up * 2, ox, oy);
      g.quadraticCurveTo(ex, ey + dn * 2, ix, iy);
      g.closePath();
    };
    outline();
    g.fillStyle = css(0xe4ddd2);
    g.fill();
    g.save();
    outline();
    g.clip();
    const ir = up * 0.62 + 0.75, cx = ex + T.gaze * 0.6, cy = ey + 0.15;
    ellPath(g, cx, cy, ir, ir);
    const rg = g.createRadialGradient(cx, cy, 0.2, cx, cy, ir);
    rg.addColorStop(0, css(shade(T.eye, -0.3)));
    rg.addColorStop(0.6, css(shade(T.eye, 0.12)));
    rg.addColorStop(1, css(shade(T.eye, -0.45)));
    g.fillStyle = rg;
    g.fill();
    ellPath(g, cx, cy, ir * 0.45, ir * 0.45);
    fillA(g, 0x0a0807, 1);
    ellPath(g, cx - 0.55, cy - 0.65, 0.45, 0.45);
    fillA(g, 0xffffff, 0.9);
    // sombra da pálpebra superior
    g.beginPath();
    g.rect(ex - w - 1, ey - up - 1, w * 2 + 2, sh === 'hooded' ? 1.9 : 1.2);
    fillA(g, shade(T.skin, -0.35), 0.45);
    g.restore();
    // pálpebra superior e prega
    const lash = mix(T.hair, 0x0a0806, 0.55);
    g.beginPath();
    g.moveTo(ix, iy);
    g.quadraticCurveTo(ex - sd * 0.3, ey - up * 2, ox, oy);
    if (T.female) g.lineTo(ox + sd * 0.9, oy - 0.7);
    strokeA(g, lash, T.female ? 1.05 : 0.85, 0.95);
    if (sh !== 'monolid') {
      g.beginPath();
      g.moveTo(ix + sd * 0.6, iy - 1.5);
      g.quadraticCurveTo(ex - sd * 0.3, ey - up * 2 - (sh === 'hooded' ? 0.4 : 1.7), ox - sd * 0.2, oy - 1.4);
      strokeA(g, shade(T.skin, -0.45), 0.55, sh === 'hooded' ? 0.55 : 0.4);
    }
    g.beginPath();
    g.moveTo(ix + sd * 0.4, iy + 0.2);
    g.quadraticCurveTo(ex, ey + dn * 2, ox, oy + 0.1);
    strokeA(g, shade(T.skin, -0.45), 0.45, 0.35);
  }

  function brows(g, T, G) {
    let c = shade(T.hair, -0.12);
    if (T.hair === HAIRS[7] || T.hair === HAIRS[6] || T.hair === HAIRS[5]) c = mix(T.hair, 0x3a2414, 0.35);
    for (const sd of [-1, 1]) {
      const ex = G.hx + sd * T.eyeSp, by = G.eyeY - 4.4 - T.browH;
      const ix = G.hx + sd * 2.3, iy = by + 0.7 + T.browIn;
      const px = ex + sd * 0.4, py = by - T.browArch;
      const ox = ex + sd * (T.eyeW + 2.3), oy = by + 1.1;
      const t = T.browT;
      g.beginPath();
      g.moveTo(ix, iy + t * 0.3);
      g.quadraticCurveTo(px, py + 0.4, ox, oy);
      g.quadraticCurveTo(px, py - t * 1.5, ix, iy - t * 0.8);
      g.closePath();
      fillA(g, c, 0.92);
    }
  }

  function nose(g, T, G) {
    const s = T.skin, x = G.hx, ny = G.noseY, nw = T.noseW;
    g.beginPath();
    g.moveTo(x + 1.3, G.eyeY + 1.6);
    g.quadraticCurveTo(x + 2.3, ny - 4, x + 1.6, ny - 1.4);
    strokeA(g, shade(s, -0.32), 1.1, 0.5);
    ellPath(g, x - 0.5, ny - 1.7, 1.5, 1.3);
    fillA(g, 0xffffff, 0.13);
    ellPath(g, x, ny + 0.9, nw * 0.9, 1.3);
    fillA(g, shade(s, -0.38), 0.4);
    for (const sd of [-1, 1]) {
      ellPath(g, x + sd * nw * 0.48, ny + 0.4, 0.95, 0.6, sd * 0.3);
      fillA(g, shade(s, -0.6), 0.8);
      g.beginPath();
      g.arc(x + sd * nw * 0.72, ny - 0.3, 1.5, sd > 0 ? -1.2 : Math.PI - 0.4, sd > 0 ? 0.4 : Math.PI + 1.2);
      strokeA(g, shade(s, -0.4), 0.6, 0.55);
    }
  }

  function mouth(g, T, G) {
    const s = T.skin, x = G.hx, my = G.mouthY, mw = T.mouthW;
    const lip = mix(s, 0x9a4a4c, T.female ? 0.4 : 0.26);
    const cd = T.expr === 'smile' ? -0.7 : T.expr === 'stern' ? 0.55 : 0.1;
    const mid = my + (T.expr === 'smile' ? 0.9 : 0.4);
    // lábio inferior
    g.beginPath();
    g.moveTo(x - mw * 0.86, my + cd * 0.6);
    g.quadraticCurveTo(x, my + 2.6 + T.lipFull, x + mw * 0.86, my + cd * 0.6);
    g.quadraticCurveTo(x, mid, x - mw * 0.86, my + cd * 0.6);
    g.closePath();
    g.fillStyle = vgrad(g, my, my + 3, shade(lip, 0.06), shade(lip, -0.2));
    g.fill();
    ellPath(g, x - 0.6, my + 1.4 + T.lipFull * 0.5, mw * 0.35, 0.5);
    fillA(g, 0xffffff, 0.14);
    // lábio superior
    g.beginPath();
    g.moveTo(x - mw, my + cd);
    g.quadraticCurveTo(x - mw * 0.55, my - 1.3, x - mw * 0.25, my - 1.5);
    g.lineTo(x, my - 1.0);
    g.lineTo(x + mw * 0.25, my - 1.5);
    g.quadraticCurveTo(x + mw * 0.55, my - 1.3, x + mw, my + cd);
    g.quadraticCurveTo(x, mid, x - mw, my + cd);
    g.closePath();
    fillA(g, shade(lip, -0.14), 0.9);
    // linha da boca
    g.beginPath();
    g.moveTo(x - mw, my + cd);
    g.quadraticCurveTo(x, mid, x + mw, my + cd);
    strokeA(g, mix(lip, 0x1a0a08, 0.6), 0.75, 0.9);
    // sombra sob o lábio e filtro
    ellPath(g, x, my + 3.6 + T.lipFull, mw * 0.5, 0.9);
    fillA(g, shade(s, -0.3), 0.32);
    g.beginPath();
    g.moveTo(x - 0.7, G.noseY + 1.8);
    g.lineTo(x - 0.6, my - 1.3);
    g.moveTo(x + 0.7, G.noseY + 1.8);
    g.lineTo(x + 0.6, my - 1.3);
    strokeA(g, shade(s, -0.25), 0.5, 0.3);
  }

  function lowerFacePath(g, T, G) {
    const x = G.hx, w = T.fw, jx = w * (0.5 + T.jaw * 0.5), cy = G.chinY, my = G.mouthY;
    g.beginPath();
    g.moveTo(x - w * 0.98, G.hy + 1);
    g.quadraticCurveTo(x - w * 0.62, G.hy + 8, x - T.mouthW - 2.2, my - 3.2);
    g.quadraticCurveTo(x, G.noseY + 2.4, x + T.mouthW + 2.2, my - 3.2);
    g.quadraticCurveTo(x + w * 0.62, G.hy + 8, x + w * 0.98, G.hy + 1);
    g.lineTo(x + jx + 2, G.hy + 14);
    g.lineTo(x + 4, cy + 3);
    g.lineTo(x - 4, cy + 3);
    g.lineTo(x - jx - 2, G.hy + 14);
    g.closePath();
  }
  function facialHair(g, T, G, pass) {
    const k = T.facial, c = T.hair, x = G.hx, my = G.mouthY, mw = T.mouthW;
    if (k === 'none') return;
    if (pass === 0 && (k === 'stubble' || k === 'beard')) {
      g.save();
      facePath(g, T, G);
      g.clip();
      lowerFacePath(g, T, G);
      if (k === 'stubble') fillA(g, mix(c, T.skin, 0.25), 0.26);
      else {
        g.fillStyle = vgrad(g, G.hy, G.chinY, shade(c, 0.12), shade(c, -0.2));
        g.globalAlpha = 0.95;
        g.fill();
        g.globalAlpha = 1;
        for (let i = 0; i < 28; i++) {
          const h = OV.U.hash32(T.seed, 300 + i, 9);
          const px = x + ((h & 255) / 255 - 0.5) * T.fw * 1.8, py = G.hy + 9 + ((h >>> 8) & 255) / 255 * (G.chinY - G.hy - 7);
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + 0.4, py + 1.4);
          strokeA(g, shade(c, 0.35), 0.4, 0.35);
        }
      }
      g.restore();
    }
    if (pass === 0 && k === 'goatee') {
      g.beginPath();
      g.moveTo(x - mw - 0.6, my + 0.6);
      g.quadraticCurveTo(x - mw - 0.4, G.chinY + 0.4, x, G.chinY + 0.9);
      g.quadraticCurveTo(x + mw + 0.4, G.chinY + 0.4, x + mw + 0.6, my + 0.6);
      g.quadraticCurveTo(x, my + 4.4, x - mw - 0.6, my + 0.6);
      g.closePath();
      fillA(g, c, 0.92);
    }
    if (pass === 1 && (k === 'moustache' || k === 'beard' || k === 'goatee')) {
      g.beginPath();
      g.moveTo(x - mw - 1.2, my + 0.8);
      g.quadraticCurveTo(x - mw * 0.6, my - 3.6, x, my - 2.6);
      g.quadraticCurveTo(x + mw * 0.6, my - 3.6, x + mw + 1.2, my + 0.8);
      g.quadraticCurveTo(x + mw * 0.4, my - 0.9, x, my - 1.2);
      g.quadraticCurveTo(x - mw * 0.4, my - 0.9, x - mw - 1.2, my + 0.8);
      g.closePath();
      g.fillStyle = vgrad(g, my - 3.6, my + 0.8, shade(c, 0.15), shade(c, -0.2));
      g.fill();
    }
  }

  function marks(g, T, G) {
    const s = T.skin;
    if (T.freckles) {
      for (let i = 0; i < 16; i++) {
        const h = OV.U.hash32(T.seed, 400 + i, 5);
        const sd = i & 1 ? 1 : -1;
        const px = G.hx + sd * (1.5 + ((h & 255) / 255) * T.fw * 0.6), py = G.noseY - 4 + (((h >>> 8) & 255) / 255) * 5;
        ellPath(g, px, py, 0.3, 0.3);
        fillA(g, shade(s, -0.28), 0.38);
      }
    }
    if (T.lines) {
      for (const dy of [0, 2]) {
        g.beginPath();
        g.moveTo(G.hx - 6, G.hy - 11 - dy);
        g.quadraticCurveTo(G.hx, G.hy - 12.2 - dy, G.hx + 6, G.hy - 11 - dy);
        strokeA(g, shade(s, -0.35), 0.5, 0.28);
      }
      for (const sd of [-1, 1]) {
        g.beginPath();
        g.moveTo(G.hx + sd * T.noseW * 1.05, G.noseY - 0.6);
        g.quadraticCurveTo(G.hx + sd * (T.mouthW + 2.4), G.mouthY - 2, G.hx + sd * (T.mouthW + 1.4), G.mouthY + 2.2);
        strokeA(g, shade(s, -0.35), 0.6, 0.32);
      }
    }
    if (T.scar) {
      const sd = T.side;
      g.beginPath();
      if (T.scar === 'brow') {
        g.moveTo(G.hx + sd * (T.eyeSp - 1.5), G.eyeY - 8.2);
        g.lineTo(G.hx + sd * (T.eyeSp + 0.6), G.eyeY - 2.6);
      } else {
        g.moveTo(G.hx + sd * (T.fw * 0.48), G.hy + 3);
        g.lineTo(G.hx + sd * (T.fw * 0.72), G.hy + 9.4);
      }
      strokeA(g, shade(s, -0.35), 1.3, 0.5);
      strokeA(g, shade(s, 0.22), 0.6, 0.85);
    }
  }

  // ---- cabelo ------------------------------------------------------------------------------------------
  function capPath(g, T, G, vol, hairY, sideY, flat) {
    const x = G.hx, w = T.fw + 0.4 + vol * 0.42, top = G.top - vol;
    g.beginPath();
    g.moveTo(x - w, sideY);
    if (flat) {
      g.bezierCurveTo(x - w - 0.4, G.hy - 16, x - w, top + 2, x - w * 0.72, top);
      g.lineTo(x + w * 0.72, top);
      g.bezierCurveTo(x + w, top + 2, x + w + 0.4, G.hy - 16, x + w, sideY);
    } else {
      g.bezierCurveTo(x - w - 0.5, G.hy - 18, x - w * 0.64, top, x, top);
      g.bezierCurveTo(x + w * 0.64, top, x + w + 0.5, G.hy - 18, x + w, sideY);
    }
    const f = T.fw, rec = T.hairline;
    g.lineTo(x + f - 2.2, sideY);
    g.bezierCurveTo(x + f - 1.4, hairY + 3 + rec, x + f * 0.5, hairY - 0.4 + rec * 0.6, x, hairY + rec * 0.3);
    g.bezierCurveTo(x - f * 0.5, hairY - 0.4 + rec * 0.6, x - f + 1.4, hairY + 3 + rec, x - f + 2.2, sideY);
    g.closePath();
  }
  function hairFill(g, T, y0, y1, a) {
    g.fillStyle = vgrad(g, y0, y1, shade(T.hair, 0.2), shade(T.hair, -0.25));
    g.globalAlpha = a === undefined ? 1 : a;
    g.fill();
    g.globalAlpha = 1;
  }
  function strands(g, T, G, y0, y1, n) {
    for (let i = 0; i < n; i++) {
      const h = OV.U.hash32(T.seed, 500 + i, 3);
      const sx = G.hx + ((h & 255) / 255 - 0.5) * T.fw * 2;
      g.beginPath();
      g.moveTo(sx * 0.6 + G.hx * 0.4, y0);
      g.quadraticCurveTo(sx, (y0 + y1) / 2, sx + (sx - G.hx) * 0.2, y1);
      strokeA(g, shade(T.hair, 0.38), 0.45, 0.22);
    }
  }
  function bumps(g, T, G, vol, r, y1) {
    const x = G.hx, w = T.fw + 0.4 + vol * 0.42, top = G.top - vol;
    for (let i = 0; i <= 14; i++) {
      const a = Math.PI + (i / 14) * Math.PI;
      const px = x + Math.cos(a) * w, py = Math.max(top + 1, G.hy - 8 + Math.sin(a) * (G.hy - 8 - top));
      if (py > y1) continue;
      ellPath(g, px, py, r, r);
      g.fillStyle = vgrad(g, py - r, py + r, shade(T.hair, 0.22), shade(T.hair, -0.2));
      g.fill();
    }
  }
  // camada de trás (antes do rosto): volumes que descem pelos lados
  function hairBack(g, T, G) {
    const st = T.style, x = G.hx;
    if (st === 'bob') {
      g.beginPath();
      g.moveTo(x - T.fw - 3.2, G.hy + 13);
      g.bezierCurveTo(x - T.fw - 5, G.hy - 10, x - T.fw * 0.7, G.top - 3, x, G.top - 3);
      g.bezierCurveTo(x + T.fw * 0.7, G.top - 3, x + T.fw + 5, G.hy - 10, x + T.fw + 3.2, G.hy + 13);
      g.quadraticCurveTo(x, G.hy + 15, x - T.fw - 3.2, G.hy + 13);
      g.closePath();
      hairFill(g, T, G.top, G.hy + 14);
    } else if (st === 'pony') {
      const sd = T.side;
      ellPath(g, x + sd * (T.fw + 2.2), G.hy + 8, 3, 9, sd * 0.25);
      hairFill(g, T, G.hy - 2, G.hy + 17);
    } else if (st === 'bun' && (T.headwear === 'none' || T.headwear === 'beret')) {
      ellPath(g, x, G.top - 1.2, 5.6, 4.6);
      hairFill(g, T, G.top - 6, G.top + 3);
      strokeA(g, shade(T.hair, -0.5), 0.5, 0.8);
    } else if ((st === 'afro' || st === 'curly') && T.female && T.headwear === 'none') {
      ellPath(g, x, G.hy - 6, T.fw + (st === 'afro' ? 8.5 : 5), st === 'afro' ? 24 : 19);
      hairFill(g, T, G.top - 8, G.hy + 12);
    }
  }
  function hairFront(g, T, G) {
    const covered = T.headwear !== 'none';
    // volumes altos ficam achatados por baixo de boina, capacete ou boné
    const st = covered && (T.style === 'afro' || T.style === 'curly' || T.style === 'flat' || T.style === 'side') ? 'crew' : T.style;
    const x = G.hx, hY = G.hy - 15.2, sY = G.hy - 2.4;
    switch (st) {
      case 'bald': {
        if (!covered) {
          ellPath(g, x - 3, G.top + 4.4, 5.4, 2.2, -0.15);
          fillA(g, 0xffffff, 0.14);
        }
        for (const sd of [-1, 1]) {
          ellPath(g, x + sd * (T.fw - 0.6), G.hy - 6, 1.6, 4.6);
          hairFill(g, T, G.hy - 11, G.hy - 1, 0.7);
        }
        return;
      }
      case 'shaved':
      case 'buzz':
      case 'cornrows': {
        capPath(g, T, G, st === 'cornrows' ? 0.9 : 0.4, hY, sY);
        hairFill(g, T, G.top, sY, st === 'shaved' ? 0.42 : st === 'buzz' ? 0.8 : 1);
        if (st === 'cornrows') {
          g.save();
          capPath(g, T, G, 0.9, hY, sY);
          g.clip();
          for (let i = -4; i <= 4; i++) {
            g.beginPath();
            g.moveTo(x + i * 3.2, hY + 1);
            g.quadraticCurveTo(x + i * 3.8, G.top + 4, x + i * 2.4, G.top - 1);
            strokeA(g, shade(T.hair, -0.6), 0.6, 0.8);
            strokeA(g, shade(T.hair, 0.4), 0.3, 0.35);
          }
          g.restore();
        }
        return;
      }
      case 'crew':
      case 'slick':
      case 'flat':
      case 'pixie':
      case 'braid':
      case 'pony':
      case 'bun': {
        const vol = st === 'flat' ? 3.8 : st === 'crew' ? 2.4 : st === 'slick' ? 2.6 : st === 'pixie' ? 2.6 : 1.6;
        const hy2 = st === 'slick' ? hY - 0.8 : hY;
        capPath(g, T, G, vol, hy2, sY, st === 'flat');
        hairFill(g, T, G.top - vol, sY);
        strokeA(g, shade(T.hair, -0.5), 0.5, 0.7);
        g.save();
        capPath(g, T, G, vol, hy2, sY, st === 'flat');
        g.clip();
        strands(g, T, G, G.top - vol, hY + 2, st === 'slick' ? 12 : 7);
        if (st === 'slick') {
          g.beginPath();
          g.moveTo(x - 6, G.top + 1);
          g.quadraticCurveTo(x - 2, G.top - 2.4, x + 5, G.top + 1.2);
          strokeA(g, 0xffffff, 0.8, 0.18);
        }
        if (st === 'bun' || st === 'pony' || st === 'braid') {
          const px = st === 'bun' ? x : x + T.side * 4;
          g.beginPath();
          g.moveTo(px, hY + 0.5);
          g.quadraticCurveTo(px + T.side * 0.5, G.top + 6, px, G.top - 1);
          strokeA(g, shade(T.hair, -0.55), 0.6, 0.8);
        }
        g.restore();
        if (st === 'pixie') {
          const sd = T.side;
          g.beginPath();
          g.moveTo(x - sd * 2, hY - 1);
          g.quadraticCurveTo(x + sd * 6, hY + 2, x + sd * (T.fw - 0.6), hY + 6.4);
          g.lineTo(x + sd * (T.fw + 0.4), hY - 2);
          g.closePath();
          hairFill(g, T, hY - 2, hY + 6.4);
        }
        return;
      }
      case 'side': {
        const sd = T.side;
        capPath(g, T, G, 3.6, hY, sY);
        hairFill(g, T, G.top - 3.6, sY);
        strokeA(g, shade(T.hair, -0.5), 0.5, 0.7);
        g.beginPath();
        g.moveTo(x - sd * 5, G.top - 3.3);
        g.bezierCurveTo(x + sd * 2, G.top - 6, x + sd * 9, G.top - 4, x + sd * (T.fw + 1), G.hy - 12);
        g.quadraticCurveTo(x + sd * 6, hY + 2.4, x - sd * 3, hY + 0.6);
        g.closePath();
        hairFill(g, T, G.top - 6, hY + 2.4);
        g.beginPath();
        g.moveTo(x - sd * 5.6, G.top - 3);
        g.quadraticCurveTo(x - sd * 6.4, G.top + 3, x - sd * 6.8, hY);
        strokeA(g, shade(T.hair, -0.55), 0.6, 0.75);
        g.save();
        capPath(g, T, G, 3.6, hY, sY);
        g.clip();
        strands(g, T, G, G.top - 4, hY + 2, 9);
        g.restore();
        return;
      }
      case 'curly':
      case 'afro': {
        const vol = st === 'afro' ? (T.female ? 9 : 7) : 3.6;
        capPath(g, T, G, vol, hY + 0.6, T.female ? G.hy + 2 : sY);
        hairFill(g, T, G.top - vol, sY);
        bumps(g, T, G, vol - 1, st === 'afro' ? 2.8 : 2.2, sY);
        g.save();
        capPath(g, T, G, vol, hY + 0.6, sY);
        g.clip();
        for (let i = 0; i < 22; i++) {
          const h = OV.U.hash32(T.seed, 600 + i, 7);
          const px = x + ((h & 255) / 255 - 0.5) * (T.fw + vol) * 2, py = G.top - vol + (((h >>> 8) & 255) / 255) * (hY - G.top + vol);
          g.beginPath();
          g.arc(px, py, 1.1, 0.2, 2.6);
          strokeA(g, shade(T.hair, 0.35), 0.4, 0.35);
        }
        g.restore();
        return;
      }
      case 'bob': {
        const sd = T.side;
        capPath(g, T, G, 3.2, hY + 3.6, G.hy + 1);
        hairFill(g, T, G.top - 3.2, G.hy);
        for (const s2 of [-1, 1]) {
          g.beginPath();
          g.moveTo(x + s2 * (T.fw - 2.4), G.hy - 6);
          g.quadraticCurveTo(x + s2 * (T.fw - 0.6), G.hy + 6, x + s2 * (T.fw * 0.86), G.hy + 13);
          g.lineTo(x + s2 * (T.fw + 3.2), G.hy + 13);
          g.quadraticCurveTo(x + s2 * (T.fw + 3.4), G.hy - 2, x + s2 * (T.fw + 1), G.hy - 8);
          g.closePath();
          hairFill(g, T, G.hy - 8, G.hy + 13);
        }
        g.beginPath();
        g.moveTo(x - sd * 4, G.top - 2.6);
        g.quadraticCurveTo(x + sd * 6, G.top - 2, x + sd * (T.fw + 0.4), hY + 4);
        g.quadraticCurveTo(x + sd * 4, hY + 5.4, x - sd * 5, hY + 2.6);
        g.closePath();
        hairFill(g, T, G.top - 3, hY + 5.4);
        strokeA(g, shade(T.hair, -0.5), 0.45, 0.6);
        return;
      }
      default:
    }
  }
  // trança sobre o ombro (depois da farda)
  function braid(g, T, G) {
    if (T.style !== 'braid') return;
    const sd = T.side;
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const px = G.hx + sd * (T.fw - 1 + t * 5), py = G.hy + 8 + t * 22;
      ellPath(g, px, py, 2.6 - t * 0.6, 2.4, sd * 0.4);
      g.fillStyle = vgrad(g, py - 2.4, py + 2.4, shade(T.hair, 0.22), shade(T.hair, -0.3));
      g.fill();
      strokeA(g, shade(T.hair, -0.55), 0.4, 0.7);
    }
  }

  // ---- cobertura de cabeça ------------------------------------------------------------------------------
  function headwear(g, T, G) {
    const k = T.headwear, x = G.hx, w = T.fw;
    if (k === 'beret') {
      const c = T.beret, by = G.hy - 13.6;
      g.beginPath();
      g.moveTo(x - w - 1.4, by + 1.8);
      g.bezierCurveTo(x - w - 8.6, by - 1.4, x - w - 5.8, G.top - 4.4, x - 4, G.top - 3.4);
      g.bezierCurveTo(x + 6, G.top - 3.8, x + w + 2.6, G.hy - 24, x + w + 1.2, by - 1.6);
      g.quadraticCurveTo(x, by + 0.4, x - w - 1.4, by + 1.8);
      g.closePath();
      const rg = g.createRadialGradient(x - w * 0.6, G.top - 1, 1, x - w * 0.2, by - 6, w * 1.6);
      rg.addColorStop(0, css(shade(c, 0.28)));
      rg.addColorStop(0.6, css(c));
      rg.addColorStop(1, css(shade(c, -0.45)));
      g.fillStyle = rg;
      g.fill();
      strokeA(g, shade(c, -0.6), 0.6, 1);
      g.beginPath();
      g.moveTo(x - w - 1.2, by + 1.1);
      g.quadraticCurveTo(x, by - 0.4, x + w + 1, by - 2.1);
      strokeA(g, 0x15110c, 2.2, 0.95);
      // insígnia sobre o olho esquerdo do soldado (direita no ecrã)
      const bx = x + w * 0.42, byy = by - 5.2;
      ellPath(g, bx, byy, 2.6, 3.1);
      fillA(g, shade(c, -0.5), 1);
      ellPath(g, bx, byy, 1.7, 2.2);
      g.fillStyle = vgrad(g, byy - 2.2, byy + 2.2, 0xffe9a0, shade(GOLD, -0.35));
      g.fill();
      strokeA(g, 0x3a2a08, 0.35, 1);
    } else if (k === 'helmet') {
      const c = T.helmet;
      g.beginPath();
      g.moveTo(x - w - 3, G.hy - 3.6);
      g.bezierCurveTo(x - w - 3.6, G.hy - 25, x - w * 0.62, G.top - 4.4, x, G.top - 4.4);
      g.bezierCurveTo(x + w * 0.62, G.top - 4.4, x + w + 3.6, G.hy - 25, x + w + 3, G.hy - 3.6);
      g.quadraticCurveTo(x + w + 1, G.hy - 5.4, x + w - 1.6, G.hy - 9);
      g.quadraticCurveTo(x, G.hy - 16.2, x - w + 1.6, G.hy - 9);
      g.quadraticCurveTo(x - w - 1, G.hy - 5.4, x - w - 3, G.hy - 3.6);
      g.closePath();
      const rg = g.createRadialGradient(x - w * 0.4, G.top + 1, 1, x, G.hy - 12, w * 1.7);
      rg.addColorStop(0, css(shade(c, 0.3)));
      rg.addColorStop(0.6, css(c));
      rg.addColorStop(1, css(shade(c, -0.5)));
      g.fillStyle = rg;
      g.fill();
      strokeA(g, shade(c, -0.65), 0.7, 1);
      g.beginPath();
      g.moveTo(x - w + 1.4, G.hy - 9.6);
      g.quadraticCurveTo(x, G.hy - 16.8, x + w - 1.4, G.hy - 9.6);
      strokeA(g, shade(c, -0.5), 1.4, 0.8);
      // fita elástica de camuflagem
      g.beginPath();
      g.moveTo(x - w - 1.8, G.hy - 13);
      g.quadraticCurveTo(x, G.hy - 21.6, x + w + 1.8, G.hy - 13);
      strokeA(g, 0x1e1e18, 1.6, 0.85);
      for (const sd of [-1, 1]) {
        g.beginPath();
        g.moveTo(x + sd * (w + 1.6), G.hy - 4);
        g.quadraticCurveTo(x + sd * (w + 0.4), G.hy + 8, x + sd * (T.chinW + 3), G.chinY - 1);
        strokeA(g, 0x2a261c, 0.8, 0.85);
      }
    } else if (k === 'cap') {
      const c = T.armour === 'coveralls' ? 0x2a6f88 : shade(ARM[T.armour].suit, -0.1);
      const ct = G.top + 1.6;
      g.beginPath();
      g.moveTo(x - w - 1.2, G.hy - 11.4);
      g.bezierCurveTo(x - w - 1.4, G.hy - 17, x - w - 0.8, ct + 1.2, x - w * 0.8, ct);
      g.quadraticCurveTo(x, ct - 1.4, x + w * 0.8, ct);
      g.bezierCurveTo(x + w + 0.8, ct + 1.2, x + w + 1.4, G.hy - 17, x + w + 1.2, G.hy - 11.4);
      g.closePath();
      g.fillStyle = vgrad(g, ct - 1.4, G.hy - 11.4, shade(c, 0.22), shade(c, -0.3));
      g.fill();
      strokeA(g, shade(c, -0.6), 0.6, 1);
      g.beginPath();
      g.moveTo(x - w * 0.8, ct + 0.4);
      g.quadraticCurveTo(x, ct - 0.8, x + w * 0.8, ct + 0.4);
      strokeA(g, shade(c, 0.35), 0.6, 0.45);
      g.beginPath();
      g.moveTo(x - w - 2.4, G.hy - 11.6);
      g.quadraticCurveTo(x, G.hy - 5.6, x + w + 2.4, G.hy - 11.6);
      g.quadraticCurveTo(x, G.hy - 9.6, x - w - 2.4, G.hy - 11.6);
      g.closePath();
      g.fillStyle = vgrad(g, G.hy - 11.6, G.hy - 6, shade(c, -0.3), shade(c, -0.6));
      g.fill();
      g.save();
      facePath(g, T, G);
      g.clip();
      g.beginPath();
      g.rect(x - w - 2, G.hy - 10.4, w * 2 + 4, 5);
      fillA(g, 0x000000, 0.13);
      g.restore();
    } else if (k === 'peaked') {
      const c = 0x1e2840;
      ellPath(g, x, G.hy - 23.4, w + 6.4, 6.4, 0);
      g.fillStyle = vgrad(g, G.hy - 30, G.hy - 17, shade(c, 0.3), shade(c, -0.25));
      g.fill();
      strokeA(g, shade(c, -0.6), 0.6, 1);
      g.beginPath();
      g.rect(x - w - 1.4, G.hy - 22, w * 2 + 2.8, 8);
      g.fillStyle = vgrad(g, G.hy - 22, G.hy - 14, shade(c, -0.1), shade(c, -0.45));
      g.fill();
      strokeA(g, shade(c, -0.7), 0.5, 1);
      g.beginPath();
      g.moveTo(x - w - 1.2, G.hy - 15.2);
      g.lineTo(x + w + 1.2, G.hy - 15.2);
      strokeA(g, GOLD, 0.9, 0.95);
      g.beginPath();
      g.moveTo(x - w - 1.6, G.hy - 14.2);
      g.quadraticCurveTo(x, G.hy - 8.4, x + w + 1.6, G.hy - 14.2);
      g.quadraticCurveTo(x, G.hy - 12, x - w - 1.6, G.hy - 14.2);
      g.closePath();
      g.fillStyle = vgrad(g, G.hy - 14, G.hy - 9, 0x3a3a40, 0x050507);
      g.fill();
      if (T.rank >= 5) {
        g.beginPath();
        g.moveTo(x - w * 0.8, G.hy - 12.4);
        g.quadraticCurveTo(x, G.hy - 9.4, x + w * 0.8, G.hy - 12.4);
        strokeA(g, GOLD, 0.7, 0.9);
      }
      // águia estilizada
      g.beginPath();
      g.moveTo(x, G.hy - 21.2);
      g.lineTo(x - 4, G.hy - 19.6);
      g.lineTo(x - 1.2, G.hy - 18.6);
      g.lineTo(x, G.hy - 16.4);
      g.lineTo(x + 1.2, G.hy - 18.6);
      g.lineTo(x + 4, G.hy - 19.6);
      g.closePath();
      g.fillStyle = vgrad(g, G.hy - 21.2, G.hy - 16.4, 0xffe9a0, shade(GOLD, -0.3));
      g.fill();
      strokeA(g, 0x3a2a08, 0.3, 1);
    }
  }

  function glasses(g, T, G) {
    if (!T.glasses) return;
    const c = 0x2a2420;
    for (const sd of [-1, 1]) {
      const ex = G.hx + sd * T.eyeSp;
      g.beginPath();
      g.ellipse(ex, G.eyeY + 0.4, T.eyeW + 1.7, 3.1, 0, 0, TAU);
      fillA(g, 0xd8e8f0, 0.08);
      strokeA(g, c, 0.7, 0.95);
      g.beginPath();
      g.moveTo(ex - 2.2, G.eyeY - 1);
      g.lineTo(ex - 0.6, G.eyeY - 2);
      strokeA(g, 0xffffff, 0.5, 0.4);
      g.beginPath();
      g.moveTo(ex + sd * (T.eyeW + 1.7), G.eyeY);
      g.lineTo(G.hx + sd * (T.fw - 0.2), G.eyeY + 0.4);
      strokeA(g, c, 0.6, 0.9);
    }
    g.beginPath();
    g.moveTo(G.hx - T.eyeSp + T.eyeW + 1.7, G.eyeY);
    g.quadraticCurveTo(G.hx, G.eyeY - 1.4, G.hx + T.eyeSp - T.eyeW - 1.7, G.eyeY);
    strokeA(g, c, 0.6, 0.9);
  }

  // grão de película e vinheta (determinísticos)
  function finish(g, T) {
    const vg = g.createRadialGradient(50, 46, 34, 50, 50, 76);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = vg;
    g.fillRect(0, 0, 100, 100);
    for (let i = 0; i < 180; i++) {
      const h = OV.U.hash32(T.grain, i, 11);
      g.fillStyle = h & 1 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
      g.fillRect((h >>> 1) % 100, (h >>> 9) % 100, 0.7, 0.7);
    }
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.strokeRect(0.5, 0.5, 99, 99);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.strokeRect(1.5, 1.5, 97, 97);
  }

  function paint(g, T) {
    const G = geom(T);
    backdrop(g, T);
    g.save();
    g.translate(G.hx, G.chinY);
    g.scale(T.headK, T.headK);
    g.translate(-G.hx, -G.chinY);
    hairBack(g, T, G);
    g.restore();
    uniform(g, T, G);
    neck(g, T, G);
    collar(g, T, G);
    braid(g, T, G);
    g.save();
    g.translate(G.hx, G.chinY);
    g.scale(T.headK, T.headK);
    g.translate(-G.hx, -G.chinY);
    ears(g, T, G);
    face(g, T, G);
    marks(g, T, G);
    facialHair(g, T, G, 0);
    mouth(g, T, G);
    facialHair(g, T, G, 1);
    nose(g, T, G);
    eye(g, T, G, -1);
    eye(g, T, G, 1);
    brows(g, T, G);
    hairFront(g, T, G);
    headwear(g, T, G);
    glasses(g, T, G);
    g.restore();
    finish(g, T);
  }

  // ---- canvas e cache ---------------------------------------------------------------------------------
  let makeCanvas = function (w, h) {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    throw new Error('Portraits: sem canvas disponível');
  };
  const cache = new Map();
  const MAX = 160;
  function render(T, px) {
    const c = makeCanvas(px, px), g = c.getContext('2d');
    g.setTransform(px / 100, 0, 0, px / 100, 0, 0);
    paint(g, T);
    return c;
  }
  function canvas(soldierLike, size) {
    const px = Math.max(8, Math.min(1024, Math.round(+size || 64)));
    const n = normalize(soldierLike);
    const k = n.seed + '|' + (n.female ? 1 : 0) + '|' + n.nat + '|' + n.armour + '|' + n.rank + '|' + px;
    let c = cache.get(k);
    if (c) {
      cache.delete(k);
      cache.set(k, c);
      return c;
    }
    c = render(traits(soldierLike), px);
    cache.set(k, c);
    while (cache.size > MAX) cache.delete(cache.keys().next().value);
    return c;
  }
  function draw(ctx, soldierLike, x, y, size) {
    const t = ctx.getTransform ? ctx.getTransform() : null;
    const sc = t ? Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1 : 1;
    const c = canvas(soldierLike, size * sc);
    ctx.drawImage(c, x, y, size, size);
    return c;
  }

  OV.Portraits = {
    draw, canvas, traits,
    STYLES: { m: M_STYLES, f: F_STYLES },
    clearCache: () => cache.clear(),
    stats: () => ({ entries: cache.size }),
    setCanvasFactory: (fn) => { makeCanvas = fn; cache.clear(); },
  };
})(globalThis.OV || (globalThis.OV = {}));
