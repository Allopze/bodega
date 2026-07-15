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

if rg --quiet --glob '*.ts' "$PATTERN" lib/ app/; then
  echo "ERROR: Se encontraron .orderBy(sql\`alias (desc|asc)\`) con alias falsos."
  echo "       Drizzle no alía sql\`...\` fragments en el SQL generado."
  echo "       Reemplaza con: .orderBy(desc(expresionReal)) o .orderBy(asc(expresionReal))."
  echo ""
  rg --glob '*.ts' "$PATTERN" lib/ app/
  exit 1
else
  echo "✓ No se encontraron alias falsos en .orderBy(sql\`...\`)"
fi
