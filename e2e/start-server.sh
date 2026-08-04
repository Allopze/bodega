#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${E2E_DATABASE_URL:-}" ]]; then
  echo "ERROR: E2E_DATABASE_URL is required. DATABASE_URL is never used as a fallback for destructive E2E setup."
  exit 2
fi

if [[ "${E2E_ALLOW_DESTRUCTIVE_RESET:-}" != "true" ]]; then
  echo "ERROR: E2E_ALLOW_DESTRUCTIVE_RESET=true is required before resetting the E2E database."
  exit 2
fi

DB_URL="$E2E_DATABASE_URL"
PORT="${E2E_PORT:-3100}"
AUTH_SECRET_VALUE="e2e-auth-secret-for-playwright"
APP_URL_VALUE="http://localhost:$PORT"
# `.env` declara tres orígenes absolutos apuntando al servidor de desarrollo
# (puerto 3001) y todos ganan sobre lo que fija este script si no se
# sobrescriben uno por uno:
#
#   AUTH_URL           gana sobre NEXTAUTH_URL en `lib/auth/auth.ts`, así que
#                      cada redirección a /login salía a localhost:3001 y las
#                      pruebas fallaban con ERR_CONNECTION_REFUSED como si el
#                      servidor E2E se hubiera caído.
#   PDF_RENDER_ORIGIN  gana sobre APP_URL en `resolvePdfRenderOrigin`, así que
#                      todo render de PDF navegaba al puerto de desarrollo.
#
# Ninguno de esos fallos era un defecto de la aplicación.

# postgres-js treats a URL without a host as TCP localhost unless PGHOST is
# explicit, while psql resolves the same URL through the local socket. Keep
# both clients on the same disposable database in local E2E runs. A host in a
# full TCP URL still wins over this default.
export PGHOST="${PGHOST:-/var/run/postgresql}"

MAINTENANCE_DB_URL="$(node -e 'const u = new URL(process.argv[1]); u.pathname = "/postgres"; console.log(u.toString())' "$DB_URL")"

# Detect common local setup problems early so the E2E run fails fast with a
# clear message instead of timing out with cryptic Postgres error codes. The
# target DB may not exist yet; e2e/setup-db.ts creates it after this check, so
# validate the maintenance database instead.
if ! psql "$MAINTENANCE_DB_URL" -c "SELECT 1" >/dev/null 2>&1; then
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

# El job de CI ya corrió su propio `npm run build` en este mismo workspace
# (paso "Build", para validar que compila). Si esta build reutiliza ese
# `.next/cache` de Turbopack, algunos chunks del cliente pueden quedar
# desincronizados del manifest de Server Actions que genera esta segunda
# build, y el navegador falla con "Failed to find Server Action" al enviar
# cualquier formulario — la página nunca navega, como si el submit no hiciera
# nada. rm -rf antes de reconstruir garantiza una build autoconsistente.
rm -rf .next

DATABASE_URL="$DB_URL" \
AUTH_SECRET="$AUTH_SECRET_VALUE" \
NEXTAUTH_SECRET="$AUTH_SECRET_VALUE" \
APP_URL="$APP_URL_VALUE" \
NEXTAUTH_URL="$APP_URL_VALUE" \
AUTH_URL="$APP_URL_VALUE" \
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
#
# rm -rf antes del cp: si .next/standalone/public/ ya existe (Next copia ahí
# los assets referenciados por import estático durante el build), `cp -r
# public .next/standalone/public` anida todo el árbol como
# .next/standalone/public/public/ en vez de fusionarlo — manifest.json, sw.js
# y demás quedan en una ruta que Next nunca sirve como estático, caen al
# router de la app, 404, y el proxy redirige a /login. rm -rf + cp -r deja
# siempre una copia limpia y completa de public/ tal cual está en el repo.
cp -r .next/static .next/standalone/.next/static
if [ -d public ]; then
  rm -rf .next/standalone/public
  cp -r public .next/standalone/public
fi

DATABASE_URL="$DB_URL" \
AUTH_SECRET="$AUTH_SECRET_VALUE" \
NEXTAUTH_SECRET="$AUTH_SECRET_VALUE" \
APP_URL="$APP_URL_VALUE" \
NEXTAUTH_URL="$APP_URL_VALUE" \
AUTH_URL="$APP_URL_VALUE" \
PDF_RENDER_ORIGIN="http://127.0.0.1:$PORT" \
SMTP_HOST="" \
SMTP_USER="" \
SMTP_PASS="" \
SMTP_FROM="" \
SMTP_DISABLED="true" \
SMTP_TIMEOUT_MS="1000" \
PORT="$PORT" HOSTNAME="0.0.0.0" node .next/standalone/server.js
