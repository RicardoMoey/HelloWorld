#!/bin/bash
# macOS: duplo-clique para servir o projeto e abrir o jogo no navegador
cd "$(dirname "$0")/.." || exit 1
PORT=8000
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
( sleep 1; open "http://localhost:$PORT/ovni-1999/" ) &
python3 -m http.server $PORT
