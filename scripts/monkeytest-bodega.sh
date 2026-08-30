#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ============================================================
# Variables QA
# ============================================================

if [[ -f "$ROOT/.env.qa" ]]; then
  set -a
  source "$ROOT/.env.qa"
  set +a
fi

# Permite usar CMD_API_KEY o directamente OPENAI_COMPATIBLE_API_KEY
if [[ -z "${OPENAI_COMPATIBLE_API_KEY:-}" ]]; then
  export OPENAI_COMPATIBLE_API_KEY="${CMD_API_KEY:-}"
fi

export OPENAI_COMPATIBLE_BASE_URL="${OPENAI_COMPATIBLE_BASE_URL:-https://api.commandcode.ai/provider/v1}"

export MONKEYTEST_STORAGE_STATE="${MONKEYTEST_STORAGE_STATE:-$ROOT/playwright/.auth/monkeytest.json}"

# ============================================================
# Configuración MonkeyTest
# ============================================================

BASE_URL="${QA_BASE_URL:-http://localhost:3001}"
MODEL="${MONKEYTEST_MODEL:-deepseek/deepseek-v4-flash}"
MAX_PAGES="${MONKEYTEST_MAX:-15}"
FLOWS="${MONKEYTEST_FLOWS:-8}"
LABEL="${MONKEYTEST_LABEL:-bodega-authenticated}"

# ============================================================
# Validaciones
# ============================================================

if [[ -z "${OPENAI_COMPATIBLE_API_KEY:-}" ]]; then
  echo "ERROR: No existe OPENAI_COMPATIBLE_API_KEY ni CMD_API_KEY."
  exit 1
fi

if [[ ! -r "$MONKEYTEST_STORAGE_STATE" ]]; then
  echo "ERROR: No existe la sesión autenticada:"
  echo "$MONKEYTEST_STORAGE_STATE"
  echo
  echo "Regénérala con:"
  echo "node scripts/qa-login.mjs"
  exit 1
fi

if ! command -v monkeytest >/dev/null 2>&1; then
  echo "ERROR: monkeytest no está disponible en PATH."
  exit 1
fi

echo "MonkeyTest Bodega"
echo "URL:    $BASE_URL"
echo "Modelo: $MODEL"
echo "Páginas: $MAX_PAGES"
echo "Flows:   $FLOWS"
echo

exec monkeytest run "$BASE_URL" \
  --provider openai_compatible \
  --model "$MODEL" \
  --base-url "$OPENAI_COMPATIBLE_BASE_URL" \
  --api-key "$OPENAI_COMPATIBLE_API_KEY" \
  --max "$MAX_PAGES" \
  --flows "$FLOWS" \
  --label "$LABEL"
