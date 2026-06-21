#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${E2E_DATABASE_URL:-postgres:///bodega_e2e}"
PORT="${E2E_PORT:-3100}"
AUTH_SECRET_VALUE="e2e-auth-secret-for-playwright"
APP_URL_VALUE="http://localhost:$PORT"

# Detect common local setup problems early so the E2E run fails fast with a
# clear message instead of timing out with cryptic Postgres error codes.
#
# Test the connection before doing anything. psql exits 2 on auth failure (28P01)
# and 2 on host-not-found; both produce a useful message on stderr.
if ! psql "$DB_URL" -c "SELECT 1" >/dev/null 2>&1; then
  echo ""
  echo "ERROR: Cannot connect to the E2E database."
  echo "  URL: $DB_URL"
  echo ""
  echo "  If running locally, set E2E_DATABASE_URL to a Postgres instance you"
  echo "  can reach, for example:"
  echo ""
  echo "    E2E_DATABASE_URL=postgres://postgres:postgres@localhost:5432/bodega_e2e npm run test:e2e"
  echo ""
  echo "  Or spin up a throwaway container:"
  echo ""
  echo "    docker run -d --name pg-e2e -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16"
  echo "    E2E_DATABASE_URL=postgres://postgres:postgres@localhost:5432/bodega_e2e npm run test:e2e"
  echo ""
  exit 1
fi

cd "$ROOT"
DATABASE_URL="$DB_URL" \
E2E_ALLOW_DESTRUCTIVE_RESET="${E2E_ALLOW_DESTRUCTIVE_RESET:-}" \
npm run e2e:setup

DATABASE_URL="$DB_URL" \
AUTH_SECRET="$AUTH_SECRET_VALUE" \
NEXTAUTH_SECRET="$AUTH_SECRET_VALUE" \
APP_URL="$APP_URL_VALUE" \
NEXTAUTH_URL="$APP_URL_VALUE" \
SMTP_HOST="" \
SMTP_USER="" \
SMTP_PASS="" \
SMTP_FROM="" \
SMTP_DISABLED="true" \
SMTP_TIMEOUT_MS="1000" \
npm run build

# El output standalone de Next no incluye assets estáticos ni public/.
# Sin esto los chunks de cliente dan 404, la página no hidrata y el form de
# login cae a un submit GET nativo (queda en /login en vez de /dashboard).
cp -r .next/static .next/standalone/.next/static
[ -d public ] && cp -r public .next/standalone/public

DATABASE_URL="$DB_URL" \
AUTH_SECRET="$AUTH_SECRET_VALUE" \
NEXTAUTH_SECRET="$AUTH_SECRET_VALUE" \
APP_URL="$APP_URL_VALUE" \
NEXTAUTH_URL="$APP_URL_VALUE" \
SMTP_HOST="" \
SMTP_USER="" \
SMTP_PASS="" \
SMTP_FROM="" \
SMTP_DISABLED="true" \
SMTP_TIMEOUT_MS="1000" \
PORT="$PORT" HOSTNAME="0.0.0.0" node .next/standalone/server.js
