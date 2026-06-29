#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${CI:-}" || -n "${E2E_DATABASE_URL:-}" ]]; then
  exec npx playwright test "$@"
fi

CONTAINER_NAME="${E2E_POSTGRES_CONTAINER:-bodega-e2e-postgres}"
PORT="${E2E_POSTGRES_PORT:-55432}"
DB_URL="postgres://postgres:postgres@127.0.0.1:${PORT}/bodega_e2e"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required for local npm run test:e2e without E2E_DATABASE_URL."
  echo "Set E2E_DATABASE_URL to an accessible disposable Postgres database to skip Docker."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    docker start "$CONTAINER_NAME" >/dev/null
  else
    docker run -d \
      --name "$CONTAINER_NAME" \
      -e POSTGRES_PASSWORD=postgres \
      -p "${PORT}:5432" \
      postgres:16 >/dev/null
  fi
fi

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER_NAME" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

E2E_DATABASE_URL="$DB_URL" npx playwright test "$@"
