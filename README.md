# 🎲 Reviravolta

**Jogo de quiz de família, otimizado para exatamente 3 jogadores.**
Mérito (saber e apostar bem) + sorte (cartas de reviravolta) + desafios + uma
grande virada final. Nada está decidido até à última pergunta.

Corre no telemóvel, tablet ou computador — basta abrir um ficheiro. Sem
instalações, sem internet, sem servidor.

## Como jogar

Abre o ficheiro **`index.html`** num browser (duplo-clique). Escreve os 3 nomes
e carrega em **Começar jogo**. Joga-se em modo *passa-e-joga*: o telemóvel anda
à volta da mesa e o ecrã avisa a quem deve passar (as apostas são secretas).

Uma partida dura ~15–20 min. Há um botão de **som** 🔊 no canto (podes silenciar).

## Categorias (9 fixas + a vossa)

Cultura Geral · História · Ciência · Desporto · Música & Cinema ·
Portugal & Madeira · Geografia · Natureza & Animais · Comida & Bebida —
**270 perguntas** no total.

E ainda uma categoria **👨‍👩‍👧 Família**: no ecrã inicial, em *Perguntas da
Família*, cada família cria as suas próprias perguntas (resposta certa + 3
erradas + nível). Ficam guardadas no dispositivo e passam a ser uma categoria
escolhível no jogo.

## Estrutura de uma partida

- **9 rondas de quiz** + **2 desafios** (a seguir às rondas 3 e 6) + a **Reviravolta Final**.

### Ronda de quiz
1. Quem responde vai rodando entre os três jogadores.
2. **Catch-up:** quem está em **último escolhe a categoria** (6 à escolha).
3. Quem responde escolhe o **nível** — e esses são os pontos que arrisca:
   - 🟢 Seguro · 1 pt   🟡 Médio · 2 pts   🔴 Difícil · 3 pts
   - Acerta → ganha esses pontos. Falha → perde-os.
4. **Apostas laterais:** os outros dois apostam em segredo se ele *acerta* ou *falha* (±1 pt) — ninguém fica de fora.
5. Rede de segurança: quem está em último pode usar um **50/50** por turno.

### 🃏 Cartas de Sorte (podem sair no início de uma ronda)
| Carta | Efeito |
|-------|--------|
| 🎁 Presente | +2 pontos para quem responde |
| 🥷 Assalto | Rouba 2 pontos ao líder |
| 🔄 Troca de Destinos | O 1.º e o último trocam de pontuação |
| ✖️2 Aposta Dobrada | A aposta da ronda conta a dobrar |
| 🛡️ Escudo | Se falhares, não perdes pontos |
| 🚀 Boleia | +3 pontos para o jogador em último |

### ⚡ Desafios
Mini-provas fora do quiz (mímica, rapidez, criatividade) avaliadas pela família.
Valem 3 pontos — quem não é craque de cultura geral também brilha.

### 🎆 Reviravolta Final
Uma última pergunta difícil. Cada jogador aposta **em segredo** quantos pontos
arrisca (até tudo o que tem — e um pouco mais). Acerta → ganha a aposta; falha →
perde-a. É aqui que o último pode roubar a vitória.

## Filosofia de design

Equilíbrio ~70% mérito / 30% sorte: o bom jogador ganha mais vezes, mas há
sempre hipótese de virada. As mecânicas de *catch-up* **dão ferramentas a quem
está atrás** em vez de castigar quem lidera — para o jogo se manter emocionante
e justo até ao fim.

## Som e animações

Tudo self-contained (funciona offline, sem ficheiros externos):
- **Sons** sintetizados via Web Audio API — acerto, erro, carta de sorte,
  desafio, tique-taque do cronómetro e fanfarra de vitória. Botão 🔊/🔇 para
  ligar/desligar (a preferência fica guardada).
- **Animações** — variação de pontos a flutuar (+N/−N) sobre o placar, "pulse"
  no acerto, "shake" no erro, salto no nome do vencedor e confétti no final.

## Personalizar

O jogo inclui **270 perguntas** (9 categorias × 3 níveis × 10), mais as da
categoria Família. Todo o jogo está num único ficheiro `index.html`. Para
adicionar mais perguntas fixas, edita o objeto `BANK` no `<script>`. Cada
pergunta é `{q, correct, wrong:[3 erradas]}`. Os desafios estão em `DESAFIOS`,
as cartas em `LUCK` e os sons em `sfx()`.

---
*Testado de ponta a ponta (setup → 9 rondas → cartas → desafios → aposta final →
vencedor) sem erros.*
