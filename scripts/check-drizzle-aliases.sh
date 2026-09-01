#!/usr/bin/env bash
set -euo pipefail

# Detects .orderBy(sql`alias desc`) where the alias won't exist in
# the generated SQL because Drizzle doesn't alias sql`...` fragments.
#
# Escanea solo lib/ y app/ (ahí viven todas las queries Drizzle).
#
# Pattern: .orderBy(sql`<simpleIdentifier> desc|asc`)
# Example of BUG:   .orderBy(sql`totalLiters desc`)
# Example of SAFE:  .orderBy(sql`coalesce(sum(...), 0) desc`)
# Example of SAFE:  .orderBy(sql`${column} desc`)

PATTERN='\.orderBy\(sql`[a-z_][a-zA-Z0-9_]* (desc|asc)'

if command -v rg >/dev/null 2>&1; then
  SEARCH=(rg --glob '*.ts' "$PATTERN" lib/ app/)
else
  SEARCH=(grep -rEn --include='*.ts' -E "$PATTERN" lib/ app/)
fi

set +e
MATCHES="$("${SEARCH[@]}" 2>&1)"
SEARCH_STATUS=$?
set -e

if [[ $SEARCH_STATUS -eq 0 ]]; then
  echo "ERROR: Se encontraron .orderBy(sql\`alias (desc|asc)\`) con alias falsos."
  echo "       Drizzle no alía sql\`...\` fragments en el SQL generado."
  echo "       Reemplaza con: .orderBy(desc(expresionReal)) o .orderBy(asc(expresionReal))."
  echo ""
  echo "$MATCHES"
  exit 1
elif [[ $SEARCH_STATUS -eq 1 ]]; then
  echo "✓ No se encontraron alias falsos en .orderBy(sql\`...\`)"
else
  echo "ERROR: No fue posible inspeccionar los archivos TypeScript."
  echo "$MATCHES"
  exit "$SEARCH_STATUS"
fi
