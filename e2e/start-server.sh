#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${E2E_DATABASE_URL:-$ROOT/.tmp/e2e.sqlite}"
if [[ "$DB_URL" != /* ]]; then
  DB_URL="$ROOT/$DB_URL"
fi
PORT="${E2E_PORT:-3100}"
AUTH_SECRET_VALUE="e2e-auth-secret-for-playwright"

cd "$ROOT"
DATABASE_URL="$DB_URL" npm run e2e:setup

DATABASE_URL="$DB_URL" \
AUTH_SECRET="$AUTH_SECRET_VALUE" \
NEXTAUTH_SECRET="$AUTH_SECRET_VALUE" \
npm run build

DATABASE_URL="$DB_URL" \
AUTH_SECRET="$AUTH_SECRET_VALUE" \
NEXTAUTH_SECRET="$AUTH_SECRET_VALUE" \
./node_modules/.bin/next start --port "$PORT"
