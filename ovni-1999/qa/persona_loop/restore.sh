#!/usr/bin/env bash
# Repõe o estado do ciclo de personas num scratchpad novo.
# Uso: bash ovni-1999/qa/persona_loop/restore.sh <scratchpad>
set -euo pipefail
DEST="${1:?indique o diretório scratchpad}"
SRC="$(cd "$(dirname "$0")/scratch" && pwd)"
OLD='/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad'
mkdir -p "$DEST"
cp -r "$SRC"/. "$DEST"/
tar -xzf "$DEST/persona/playlogs_r1-r5.tar.gz" -C "$DEST/persona"
# os scripts de workflow usam o caminho da sessão original
grep -rl "$OLD" "$DEST/wf" "$DEST/press" 2>/dev/null | xargs -r sed -i "s#$OLD#$DEST#g"
echo "Estado reposto em $DEST"
