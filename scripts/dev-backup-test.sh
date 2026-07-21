#!/usr/bin/env bash
set -euo pipefail

# ── Dev backup test — ejecuta backup + restore completo en local ──────────────
# No toca /srv/bodega ni Google Drive. Usa paths temporales y la DB E2E.
#
# Uso:
#   bash scripts/dev-backup-test.sh
#
# Lo que hace:
#   1. Backup de PostgreSQL local + storage a /tmp/bodega-backups/
#   2. Restore del dump a la base bodega_e2e (E2E_DATABASE_URL)
#   3. Verifica conteo de tablas entre original y restaurada
# ──────────────────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/tmp/bodega-backups}"
RESTORE_DIR="${RESTORE_DIR:-/tmp/bodega-restore}"
STORAGE_PATH="${STORAGE_PATH:-${ROOT_DIR}/storage}"
PG_URL="${DATABASE_URL:-postgres:///bodega}"
E2E_URL="${E2E_DATABASE_URL:-postgres:///bodega_e2e}"

export PATH="${HOME}/.local/bin:${PATH}"
export BACKUP_DIR
export STORAGE_PATH
export DATABASE_URL="${PG_URL}"
export APP_VERSION="dev-test"
export RETENTION_DAYS=7
export HOME="${HOME}"
export NODE_ENV=development

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; exit 1; }
info() { echo -e "${YELLOW}→${NC} $*"; }
check() {
  if [ "$1" -eq 0 ]; then pass "$2"; else fail "$2"; fi
}

info "=== Dev Backup Test ==="
info "PG:      ${PG_URL}"
info "E2E:     ${E2E_URL}"
info "Backups: ${BACKUP_DIR}"
info "Restore: ${RESTORE_DIR}"
info "Storage: ${STORAGE_PATH}"

# ── Prerrequisitos ────────────────────────────────────────────────────────
info "Verificando herramientas..."
command -v pg_dump >/dev/null || fail "pg_dump no encontrado"
command -v pg_restore >/dev/null || fail "pg_restore no encontrado"
command -v psql >/dev/null || fail "psql no encontrado"
pass "pg_dump, pg_restore, psql disponibles"

# Verificar que ambas DBs existen
psql "${PG_URL}" -c "SELECT 1" >/dev/null 2>&1 || fail "DB origen no accesible"
pass "DB origen accesible"
psql "${E2E_URL}" -c "SELECT 1" >/dev/null 2>&1 || fail "DB E2E no accesible (crea la DB primero: createdb bodega_e2e)"
pass "DB E2E accesible"

# ── Contar tablas en origen ───────────────────────────────────────────────
ORIG_TABLES=$(psql "${PG_URL}" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
info "Tablas en origen: ${ORIG_TABLES}"

# ── Limpiar directorios anteriores ─────────────────────────────────────────
rm -rf "${BACKUP_DIR}" "${RESTORE_DIR}"
mkdir -p "${BACKUP_DIR}/snapshots"

# ── Paso 1: pg_dump ────────────────────────────────────────────────────────
info "[1/4] pg_dump de la base de datos..."
DATE_STR=$(date '+%Y-%m-%d')
SNAPSHOT_DIR="${BACKUP_DIR}/snapshots/${DATE_STR}"
mkdir -p "${SNAPSHOT_DIR}"

PG_FILE="${SNAPSHOT_DIR}/postgres.dump"
pg_dump "${PG_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --file="${PG_FILE}" 2>&1 | tail -3

check $? "pg_dump completado"
PG_SIZE=$(wc -c < "${PG_FILE}" | tr -d ' ')
info "  Tamaño: ${PG_SIZE} bytes"

# ── Paso 2: Storage tar ────────────────────────────────────────────────────
info "[2/4] Comprimiendo storage..."
STORAGE_FILE="${SNAPSHOT_DIR}/storage.tar.gz"
if [ -d "${STORAGE_PATH}" ]; then
  tar -czf "${STORAGE_FILE}" \
    --exclude='.health-*.tmp' \
    -C "$(dirname "${STORAGE_PATH}")" \
    "$(basename "${STORAGE_PATH}")" 2>&1
  check $? "storage comprimido"
  STORAGE_SIZE=$(wc -c < "${STORAGE_FILE}" | tr -d ' ')
  info "  Tamaño: ${STORAGE_SIZE} bytes"
else
  info "  Storage no existe, omitiendo"
  touch "${STORAGE_FILE}"
  STORAGE_SIZE=0
fi

# ── Paso 3: Crear manifest.json ────────────────────────────────────────────
info "[3/4] Generando manifest.json..."
PG_SHA=$(sha256sum "${PG_FILE}" | cut -d' ' -f1)
STORAGE_SHA=$(sha256sum "${STORAGE_FILE}" | cut -d' ' -f1)

cat > "${SNAPSHOT_DIR}/manifest.json" <<MANIFEST
{
  "backup": {
    "date": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
    "date_str": "${DATE_STR}",
    "app_version": "dev-test",
    "hostname": "$(hostname)",
    "tool": "dev-backup-test.sh"
  },
  "components": {
    "postgres": {
      "file": "postgres.dump",
      "size_bytes": ${PG_SIZE},
      "sha256": "${PG_SHA}",
      "format": "pg_dump custom (Fc)"
    },
    "storage": {
      "file": "storage.tar.gz",
      "size_bytes": ${STORAGE_SIZE},
      "sha256": "${STORAGE_SHA}",
      "format": "tar.gz"
    }
  },
  "total_size_bytes": $((PG_SIZE + STORAGE_SIZE))
}
MANIFEST

pass "manifest.json creado"

# ── Paso 4: Validar estructura del dump ────────────────────────────────────
info "[4/4] Validando estructura del dump..."
if pg_restore --list "${PG_FILE}" >/dev/null 2>&1; then
  pass "Estructura del dump: OK"
else
  fail "El dump tiene estructura inválida"
fi

# ── Restore a DB E2E ───────────────────────────────────────────────────────
info ""
info "=== Restaurando a bodega_e2e ==="

info "Eliminando esquema público en E2E..."
psql "${E2E_URL}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1
check $? "Esquema E2E reseteado"

info "pg_restore a bodega_e2e..."
pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname="${E2E_URL}" \
  "${PG_FILE}" 2>&1 | tail -5

check $? "pg_restore completado"

# ── Verificar conteo de tablas ─────────────────────────────────────────────
RESTORED_TABLES=$(psql "${E2E_URL}" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
info "  Tablas en origen:   ${ORIG_TABLES}"
info "  Tablas en E2E:      ${RESTORED_TABLES}"

if [ "${ORIG_TABLES}" -eq "${RESTORED_TABLES}" ]; then
  pass "Conteo de tablas coincide: ${ORIG_TABLES} = ${RESTORED_TABLES}"
else
  fail "DISCREPANCIA: origen ${ORIG_TABLES} ≠ E2E ${RESTORED_TABLES}"
fi

info ""
info "=== Dev Backup Test COMPLETADO ==="
info "  Backup:   ${SNAPSHOT_DIR}"
info "  Dump:     ${PG_FILE} (${PG_SIZE} bytes)"
info "  Restore:  bodega_e2e (${RESTORED_TABLES} tablas)"
info "  Limpieza: rm -rf ${BACKUP_DIR} ${RESTORE_DIR}"
info ""
pass "Todo OK — el ciclo backup → validate → restore funciona en desarrollo."
