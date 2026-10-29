# Convenções de engenharia — OVNI: Inimigo Desconhecido (`ovni-1999/`)

Documento vinculativo para quem escreve código neste diretório (pessoas e agentes).
A especificação funcional completa está em [`DESIGN.md`](DESIGN.md); a REA (engenharia
reversa) em [`docs/rea/`](docs/rea). Em caso de conflito: este ficheiro > DESIGN.md §2 > restante DESIGN.md.

## 1. Idioma
- Interface do jogador: **português europeu (pt-PT)**, sempre via `OV.T('chave', {params})`.
  Nunca escrever texto visível ao jogador dentro de `js/sim/**` ou `js/data/**` — usar `nameKey`/chaves.
- Código, identificadores e comentários técnicos: comentários curtos em português; identificadores em inglês.

## 2. Módulos e carregamento
- JavaScript clássico (sem ES modules, sem build, sem dependências, sem rede em runtime).
- Cada ficheiro é um IIFE que escreve no namespace global `OV`:
  ```js
  (function (OV) {
    'use strict';
    // ...
    OV.Path = { find, reachable };
  })(globalThis.OV || (globalThis.OV = {}));
  ```
- **`index.html` é a fonte única da ordem de carregamento.** Ao criar um ficheiro, ele já tem de estar
  listado lá (todos os ficheiros planeados já estão). `tools/load.js` lê essa lista e carrega em Node as
  camadas `core`, `i18n`, `data`, `sim`.
- Camadas (sem importações "para cima"): `core → i18n → data → sim → gfx → audio → ui → main`.
  - `js/core/**`, `js/i18n/**`, `js/data/**`, `js/sim/**` têm de correr em **Node** sem DOM:
    proibido `document.`, `window.`, `Math.random`, `performance.`, `requestAnimationFrame`,
    `localStorage` (exceto `sim/save.js` atrás de verificação), `OV.audio`, `OV.Dom`, `OV.Input`,
    `OV.Scenes`, `OV.View` e qualquer `OV.<gfx/ui>`. Um teste verifica isto.
  - Nenhum módulo lê "o jogo atual" de uma global: funções recebem `G` (campanha) ou `B` (batalha).
    Só `js/main.js` guarda o jogo corrente.

## 3. Estado
- `G` e `B` são **JSON puro**: números, strings, arrays, objetos simples, typed arrays (serializados
  em base64 por `sim/save.js`). Referências por **id** (`typeId`, `unitId`, `craftId`), nunca objetos de regras.
- Caches derivados vivem em `B._` / `G._` (não serializados), reconstruídos por `rebuildDerived()`.
- Regras/dados (`OV.Data.*`) são imutáveis depois de `OV.Data.finalize()`.

## 4. Aleatoriedade e determinismo
- Só `OV.RNG` (mulberry32 com estado guardável). Streams: `geo`, `map`, `combat`, `ai` (simulação) e
  `ui` (pré-visualizações, cosmética). A interface **nunca** consome streams da simulação.
- Batalha: aritmética inteira para tudo o que decide resultados (UT, precisão, desvio, dano, LOS, luz,
  explosões). Usar `OV.U.idiv`, `OV.U.isqrt`. Floats só em animação e no Geoscape.
- Mesma semente + mesmas ações ⇒ mesmo `hash(B)`. Há testes para isso.

## 5. Eventos e ações (Battlescape)
- A batalha muda **apenas** através de geradores `OV.Act.perform(B, action)` que fazem `yield` de
  eventos tipados (estado já atualizado quando o evento sai). Lista de tipos: DESIGN.md §10.
- O `ui/presenter.js` anima cada evento; código headless apenas esgota o gerador.
- A apresentação nunca altera `B`/`G` (partículas, decalques e caches de sprites ficam em `OV.FX`/gfx).

## 6. Constantes
- Constantes de jogabilidade com nome em `js/data/tuning.js` (`OV.TUNE`). Novas constantes de uma área:
  ficheiro próprio `js/data/tuning_<area>.js` com `Object.assign(OV.TUNE, {...})` — evita conflitos.
- Constantes de arte (cores, tamanhos de sprite) ficam no módulo gfx respetivo.

## 7. Cores
- Uma só representação: **inteiro `0xRRGGBB`**. Helpers em `OV.Color`: `shade(c, f)`, `mix(a, b, t)`,
  `css(c, alpha?)`. Converter para string CSS só no momento de `ctx.fillStyle = OV.Color.css(c)`.

## 8. Coordenadas e direções
- Mapa de batalha `w × h × d`; índice `i = (z*h + y)*w + x`. Tile = 16×16×24 voxels.
- Direções 0..7 = N, NE, E, SE, S, SW, W, NW com `OV.U.DX/DY` (N = y−1, aponta para cima-direita no ecrã),
  8 = subir, 9 = descer.
- Isométrico (`OV.Iso`): `TW 64`, `TH 32`, `LH 48` px CSS a zoom 1; canto superior do losango do tile
  `(x,y,z)` em `sx = (x−y)·32`, `sy = (x+y)·16 − z·48`.
- Partes de tile: `0 chão, 1 parede oeste, 2 parede norte, 3 objeto` (paredes nas arestas oeste/norte).

## 9. i18n
- `js/i18n/pt-PT.js` define `OV.STR` e `OV.T`. Cada área tem o seu ficheiro (`pt-PT.data.js`,
  `pt-PT.battle.js`, `pt-PT.geo.js`, `pt-PT.base.js`, `pt-PT.ufopaedia.js`) com
  `Object.assign(OV.STR, {...})`. Chaves em `area.subarea.nome` (ex.: `item.rifle`, `bs.noTU`).
- Interpolação `{nome}`; plural com `OV.Tn(chave, n, params)` (`chave.one` / `chave.other`).
- Chave em falta devolve `⟦chave⟧` (visível de propósito para o QA apanhar).

## 10. CSS e DOM
- Tokens e componentes base em `css/base.css`. Cada área tem o seu ficheiro (`css/battle.css`,
  `css/geo.css`, `css/base.css` é só base; `css/basescape.css`, `css/screens.css`).
- Texto e painéis em DOM (`#hud`, `#modals`, `#toasts`); mapas/globo em canvas (`#view`).
- Acessibilidade: `aria-live` nos toasts, foco visível, alvos ≥ 32 px em toque, `(hover:none)` sem tooltips.

## 11. Testes (obrigatórios)
- `node ovni-1999/tools/test.js` corre todos os `tools/tests/*.test.js`. Cada módulo novo traz testes.
- Formato de um ficheiro de teste:
  ```js
  module.exports = function (OV, t) {
    t.test('rifle snap 33% com Pontaria 55', () => {
      t.eq(OV.Combat.accuracy(...), 33);
    });
  };
  ```
- API: `t.test(nome, fn)`, `t.eq(a, b, msg)`, `t.ok(v, msg)`, `t.near(a, b, eps, msg)`,
  `t.throws(fn, msg)`, `t.args` (argumentos da linha de comandos).
- Antes de cada commit: `node ovni-1999/tools/test.js` verde.

## 12. Git
- Commits pequenos por marco (M0, M1, …), autor `Claude <noreply@anthropic.com>`.
- Ramo `main`. Nunca reescrever histórico publicado.
