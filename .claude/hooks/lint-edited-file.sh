#!/usr/bin/env bash
# Hook PostToolUse (Edit|Write) de Claude Code.
#
# Por qué sólo el archivo editado y no `npm run lint` completo: el lint del repo
# tarda minutos y pide un lock en scripts/run-resource-guard.sh, así que un agente
# que edita diez archivos encadenaría diez esperas. Sobre un archivo suelto, ESLint
# responde en ~1s (medido 2026-11 sobre components/ui/kpi-card.tsx).
#
# Sale 0 siempre: este hook informa, no bloquea. Un archivo con deuda previa no
# debe impedir que el agente termine su turno; la puerta real sigue siendo
# `npm run lint` antes de declarar terminado.
set -uo pipefail

payload="$(cat)"
file="$(printf '%s' "$payload" | node -e '
let raw = ""
process.stdin.on("data", (chunk) => (raw += chunk))
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw)
    process.stdout.write(input?.tool_input?.file_path ?? "")
  } catch {
    process.stdout.write("")
  }
})
')"

[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0
case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root" || exit 0
[ -x node_modules/.bin/eslint ] || exit 0

output="$(node_modules/.bin/eslint --no-warn-ignored "$file" 2>&1)"
status=$?

if [ "$status" -ne 0 ] && [ -n "$output" ]; then
  printf 'ESLint encontró problemas en %s:\n%s\n' "$file" "$output" >&2
fi

exit 0
