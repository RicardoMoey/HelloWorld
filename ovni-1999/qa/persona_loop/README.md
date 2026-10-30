# Ciclo de playtests por personas — ponto de situação

Em pausa a pedido do utilizador depois da ronda 5 (commit `f6c4235`).

## Personas
Rui (veterano X-COM), Sofia (casual, trackpad), Tiago (11 anos), Inês (otimizadora),
Pedro (só teclado, deuteranopia, zoom 125 %), Marta (iPad, toque).

## Critério de paragem
Duas rondas seguidas sem achados novos de gravidade major ou critical.

## Histórico
| Ronda | Rui | Sofia | Tiago | Inês | Pedro | Marta | Majors |
|---|---|---|---|---|---|---|---|
| 3 | 7 | 7 | 7 | 7 | 7 | 8 | 16 |
| 4 | 7 | 6,5 | 6 | 7 | 7 | 8 | 7 |
| 5 | 7 | 7 | 6 | 7 | 8 | 8 | 9 |

Todos os achados da ronda 5 foram corrigidos e integrados (844 testes,
26 scripts QA e `full_campaign` verdes). Bot Veterano: 13/24 campanhas (54 %),
meta 55–67 %; derrotas em Cidónia e por tempo, sem derrotas do conselho.

## Arquivo
`scratch/` espelha o scratchpad da sessão original (sem capturas de ecrã):
- `persona/` — achados, notas e relatórios de todas as rondas (r1–r5) e `playlogs_r1-r5.tar.gz`
  (scripts e registos de jogo das personas);
- `wf/` — todos os scripts de workflow (personas, corretores, integradores) e `gen_persona.py`;
- `*.json`, `*.md` — relatórios das ondas de desenvolvimento citados pelos scripts;
- `press/` — dossiê de imprensa (HTML web, HTML para PDF, PDF, imagens e scripts que os geram).

Repor num scratchpad novo: `bash ovni-1999/qa/persona_loop/restore.sh <scratchpad>`
(copia, extrai os registos e troca o caminho antigo nos scripts).

## Retomar (ronda 6)
0. Repor o arquivo com `restore.sh`.
1. `git worktree add --detach <scratch>/snap_r6 HEAD` — as personas testam uma cópia congelada.
2. `python3 <scratchpad>/wf/gen_persona.py 6` gera `persona_r6_{1,2,3}.js` (pares: veterano+casual,
   crianca+minmaxer, acessivel+ipad); mudar o `BRIEF(k)` para apontar para o snapshot.
3. Encaminhar os achados para 4 corretores com posse estrita de ficheiros
   (A: combate/inventário/gfx/input; B: geo/base/campanha/dom/ufopédia/interceção;
   C: `screens.js`; S: sim/data/tools/docs) — ver `scratch/wf/p5fix*.js`.
4. Integrador (`scratch/wf/p5integ.js`) para as pendências entre corretores e o varrimento de equilíbrio.
5. Verificar os ficheiros de cada corretor sozinhos sobre HEAD, `node tools/test.js --strict --i18n`, commit por corretor.


## Pendências conhecidas (menores)
- AUTO-EQUIPAR na base não troca a pistola por um Lança-Foguetes guardado.
- Dica do relatório pela causa de morte dominante (ex.: granada alienígena).
- Marcadores do arco das granadas podem ficar escondidos atrás de paredes do OVNI.
