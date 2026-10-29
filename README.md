# HelloWorld — Jogos de Família

Projeto dedicado a **jogos de família**. Cada jogo é uma app web jogável no
browser, sem instalações. A página **`index.html`** é o menu de entrada.

**Jogos disponíveis:**
- 🎲 **[Reviravolta](reviravolta.html)** — quiz para 3 jogadores com sorte, desafios e viradas.
- 🎯 **[Command & Geopolitics: 2026](command-2026/index.html)** — estratégia em tempo real (RTS) ao estilo Command & Conquer, 1 jogador contra IA.
- 🛸 **[OVNI: Inimigo Desconhecido](ovni-1999/index.html)** — engenharia reversa de UFO: Enemy Unknown (1994): Geoscape, bases e combate tático por turnos.

## Como correr (macOS)

Duplo-clique em `index.html` funciona para o Reviravolta. Para o RTS, o Safari
bloqueia alguns recursos em `file://`, por isso o mais fiável é servir a pasta:

```bash
cd HelloWorld
python3 -m http.server 8000
```

Abre `http://localhost:8000` no Safari ou Chrome (se já tinhas clonado antes, corre primeiro `git switch main && git pull`). Tudo é self-contained: sem
dependências, sem internet, sem servidor para além deste.

### Instalar como app (iPad / iPhone / Android)

`manifest.json` + `sw.js` (service worker) fazem o projeto abrir em ecrã inteiro
e funcionar **offline**. Precisa de ser servido por **https** (ex.: GitHub Pages):

1. No repositório: **Settings → Pages → Deploy from a branch** → branch `main`, pasta `/(root)` → **Save**.
2. Abre o URL de Pages no **Safari** (iPad/iPhone) ou **Chrome** (Android).
3. **Partilhar → Adicionar ao ecrã principal**.

---

## 🛸 OVNI: Inimigo Desconhecido

Engenharia reversa jogável de **UFO: Enemy Unknown** (X-COM, 1994), reconstruída
de raiz para o browser e pensada para o Mac (trackpad e teclado) e para o iPad.
Tudo em `ovni-1999/`: JavaScript sem dependências, arte procedimental e som
sintetizado em tempo real.

- **Geoscape:** globo em tempo real com seis velocidades; radares detetam OVNIs,
  os Intercetores abatem-nos numa janela de duelo própria e o Skyranger leva a
  equipa ao local. No fim de cada mês, o conselho de 17 países avalia e financia.
- **Bases:** grelha 6×6, 13 instalações, mercado, 45 projetos de investigação,
  25 produtos de fabrico, contenção e interrogatórios até Cidónia, em Marte.
- **Battlescape:** combate por turnos com Unidades de Tempo, fogo de reação,
  precisão e desvio reais, moral e pânico, noite e sinalizadores, terreno
  destrutível, 9 terrenos e 8 classes de OVNI. Pré-visualização do caminho, da
  probabilidade de acerto e da área de explosão.
- **Ufopédia:** 80 artigos com ilustrações e fichas geradas a partir das regras.
- **Gravações:** automática, por turno e três espaços manuais, com exportação.

Para jogar: servir a pasta como acima e abrir `http://localhost:8000/ovni-1999/`
(ou duplo clique em `ovni-1999/serve.command`). O «Como Jogar» do menu tem os
controlos de trackpad, teclado e toque.

Para desenvolver: `node ovni-1999/tools/test.js --strict` (testes),
`node ovni-1999/tools/sim.js battle|campaign …` (simulações com bots) e os
scripts Playwright em `ovni-1999/qa/`. O desenho está em
[`ovni-1999/DESIGN.md`](ovni-1999/DESIGN.md), a engenharia reversa em
[`ovni-1999/docs/rea/`](ovni-1999/docs/rea) e o contrato da campanha em
[`ovni-1999/docs/CAMPAIGN_API.md`](ovni-1999/docs/CAMPAIGN_API.md).

UFO: Enemy Unknown © 1994 MicroProse / Mythos Games (Julian Gollop). Projeto de
fãs, sem fins comerciais. Regras com base na documentação do OpenXcom; mapa-mundo
Natural Earth.

---

## 🎯 Command & Geopolitics: 2026

RTS clássico (construção de base, economia, combate pedra-papel-tesoura, nevoeiro
de guerra) ambientado na geopolítica de 2026: escassez de terras raras, redes de
energia, conflitos por procuração e ciberguerra. Tudo em `command-2026/`:
`index.html` + módulos JS/CSS, Canvas 2D, zero dependências.

### Coligações

| Coligação | Doutrina | Unidades únicas | Poderes de apoio |
|---|---|---|---|
| **Aliança Atlântica** (NATO/UE) | Tecnologia equilibrada, mobilidade; defesas com +20% de alcance | Atirador de Elite, Blindado Ágil, Lança-Foguetes de Precisão, Drone de Vigilância | Varredura de Satélite, Ataque Orbital |
| **Eixo Euroasiático** | Blindados pesados, artilharia; produção 20% mais rápida | Tanque Pesado, Artilharia Autopropulsada, Lança-Foguetes Múltiplo | Barragem de Artilharia, Míssil Hipersónico |
| **Vanguarda do Sul Global** | Assimétrica; edifícios 15% mais baratos | Hacker, Tanque Fantasma (furtivo), Técnicas, Enxame de Drones | Ciberataque, Pulso EMP |

### Mecânicas

- **Economia de 2 recursos.** *Capital*: Extratores recolhem terras raras e
  descarregam na Refinaria; Engenheiros capturam Poços de Petróleo neutros.
  *Energia*: Centrais produzem, o resto consome. Com energia negativa a
  produção cai para 30%, o radar apaga-se, as defesas com energia (Antitanque,
  SAM) desligam-se e os poderes de apoio param.
- **Construção em grelha** com validação de raio (4 tiles de outro edifício teu),
  terreno, unidades no local e saída da refinaria. Edifícios vendem-se (50%) e
  reparam-se (custo gradual).
- **Triângulo tático:** Veículos > Infantaria > Aéreo > Veículos. Cada arma tem
  uma ogiva com multiplicadores por tipo de blindagem.
- **Micro:** atacar-mover (A), parar (S), grupos de controlo (Ctrl+1–9),
  seleção por caixa, duplo-clique por tipo, ponto de reunião, Engenheiros
  capturam/reparam, MCV implanta um novo Centro de Comando (D).
- **Nevoeiro de guerra** por jogador (visível / explorado), unidades furtivas
  reveladas por proximidade, detetores ou radar.
- **IA adversária:** árvore de comportamento (behavior tree) que gere energia e
  economia, constrói a base por plano, produz contra-unidades segundo o que
  avista, defende a base, lança vagas (reunir → atacar → recuar), envia
  batedores, captura poços e usa poderes de apoio. Três dificuldades.
- **Apresentação:** HUD militar, minimapa/radar, tremor de ecrã na artilharia,
  crateras e destroços, partículas, áudio procedimental (Web Audio API), música
  generativa e voz de comando em português (síntese de fala do sistema).

### Controlos

| | |
|---|---|
| Clique / arrastar | Selecionar / caixa de seleção (Shift ou ⌘ adiciona) |
| Botão direito (ou ctrl+clique) | Ordem contextual: mover, atacar, colher, capturar, reunião |
| Bordas do ecrã, setas, 2 dedos no trackpad | Mover a câmara · pinça ou `+`/`-` para zoom |
| A / S / D | Atacar-mover · Parar · Implantar MCV |
| Q / W / E | Exército no ecrã · todo o exército · mesmo tipo |
| R / V | Modo reparar · modo vender |
| H / Espaço | Ir para a base · ir para o último alerta |
| Tab · P · Esc · F2 | Separador de construção · pausa · cancelar · FPS |

No iPad: toque seleciona/ordena, arrastar move o mapa, toque longo + arrastar
faz caixa de seleção, pinça faz zoom.

### Arquitetura (`command-2026/js/`)

| Ficheiro | Responsabilidade |
|---|---|
| `core.js` | namespace, matemática, RNG determinístico (mulberry32), ruído, armazenamento |
| `data.js` | ogivas, armas, unidades, edifícios, fações, poderes, dificuldades |
| `map.js` | mapa procedimental com simetria de rotação, campos de terras raras, poços |
| `spatial.js` | partição espacial por grelha (hash) para consultas por raio |
| `path.js` | A* com heap binária e carimbos de geração, suavização por linha de vista, fila com orçamento por tick |
| `entities.js` | criação, colocação, energia, filas de produção, captura, destruição |
| `units.js` | ordens, movimento e separação local, colheita, engenheiros, MCV, aquisição de alvos, torres |
| `combat.js` | disparo, projéteis, dano em área, poderes de apoio, partículas e tremor |
| `fog.js` | nevoeiro de guerra e deteção de furtivos |
| `ai.js` | árvore de comportamento da IA |
| `audio.js` | efeitos sintetizados posicionais, música generativa, voz |
| `sprites.js` | desenho vetorial de unidades/edifícios (nítido em Retina), ícones |
| `render.js` | terreno pré-calculado, atlas por escala, entidades interpoladas, nevoeiro, minimapa |
| `input.js` | rato, trackpad, teclado, toque; modos de ordem |
| `ui.js` | menu, barra lateral, dicas, pausa, ecrã final |
| `game.js` | estado, ciclo de simulação a 60 Hz com passo fixo e interpolação no render, vitória/derrota |

A simulação é determinística dada a semente; o motor corre também em Node.js
sem browser (útil para testar IA contra IA).

---

## 🎲 Reviravolta

**Jogo de quiz de família, otimizado para exatamente 3 jogadores.**
Mérito (saber e apostar bem) + sorte (cartas de reviravolta) + desafios + uma
grande virada final. Nada está decidido até à última pergunta.

### Como jogar

Abre **`reviravolta.html`**. Escreve os 3 nomes e carrega em **Começar jogo**.
Joga-se em modo *passa-e-joga*: o telemóvel anda à volta da mesa e o ecrã avisa
a quem deve passar (as apostas são secretas). Uma partida dura ~15–20 min.
Há um botão de **som** 🔊 no canto.

### Categorias (9 fixas + a vossa)

Cultura Geral · História · Ciência · Desporto · Música & Cinema ·
Portugal & Madeira · Geografia · Natureza & Animais · Comida & Bebida —
**270 perguntas** no total. E ainda a categoria **👨‍👩‍👧 Família**: cada família
cria as suas próprias perguntas (guardadas no dispositivo).

### Estrutura de uma partida

- **9 rondas de quiz** + **2 desafios** (a seguir às rondas 3 e 6) + a **Reviravolta Final**.
- Quem está em **último escolhe a categoria**; quem responde escolhe o nível
  (🟢 1 pt · 🟡 2 pts · 🔴 3 pts) e arrisca esses pontos.
- **Apostas laterais:** os outros dois apostam em segredo se acerta ou falha (±1 pt).
- Quem está em último pode usar um **50/50** por turno.
- 🃏 **Cartas de Sorte** (Presente, Assalto, Troca de Destinos, Aposta Dobrada,
  Escudo, Boleia) podem sair no início de uma ronda.
- ⚡ **Desafios** (mímica, rapidez, criatividade) valem 3 pontos.
- 🎆 **Reviravolta Final:** aposta secreta de pontos numa última pergunta difícil.

Equilíbrio ~70% mérito / 30% sorte; as mecânicas de *catch-up* dão ferramentas
a quem está atrás em vez de castigar quem lidera.

### Personalizar

Todo o jogo está num único ficheiro. Para adicionar perguntas fixas, edita o
objeto `BANK` no `<script>` (`{q, correct, wrong:[3 erradas]}`). Os desafios
estão em `DESAFIOS`, as cartas em `LUCK` e os sons em `sfx()`.
