#!/usr/bin/env bash
set -euo pipefail

# ── Restore All — Restauración completa desde Google Drive ────────────────────
# Uso en desastre:
#   1. Servidor nuevo, instalar Docker + Node + PostgreSQL
#   2. Configurar rclone con Service Account (ver SETUP_GOOGLE_DRIVE_BACKUP.md)
#   3. Ejecutar este script
#
# Usage:
#   ./scripts/restore-all.sh                             # restore desde latest
#   RESTORE_DATE=2026-07-19 ./scripts/restore-all.sh      # restore fecha específica
#   RESTORE_TARGET=/srv/bodega/restore ./scripts/restore-all.sh   # directorio destino
#
# Flags:
#   --dry-run             Solo muestra qué se restauraría
#   --skip-pg             No restaurar PostgreSQL
#   --skip-storage        No restaurar storage
#   --skip-config         No restaurar configuración
#   --verify-only         Solo verificar integridad, no restaurar
# ──────────────────────────────────────────────────────────────────────────────

# ── Configuración ─────────────────────────────────────────────────────────────

RESTORE_DATE="${RESTORE_DATE:-latest}"
RESTORE_TARGET="${RESTORE_TARGET:-/srv/bodega/restore}"
GDRIVE_DEST="${GDRIVE_DEST:-gdrive-backups:bodega-backups}"
STORAGE_PATH="${STORAGE_PATH:-/srv/bodega/storage}"
ENV_TARGET="${ENV_TARGET:-/srv/bodega/.env}"

DRY_RUN=false
SKIP_PG=false
SKIP_STORAGE=false
SKIP_CONFIG=false
VERIFY_ONLY=false

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --skip-pg) SKIP_PG=true ;;
    --skip-storage) SKIP_STORAGE=true ;;
    --skip-config) SKIP_CONFIG=true ;;
    --verify-only) VERIFY_ONLY=true ;;
    *) log "WARN: Argumento desconocido: $arg" ;;
  esac
done

# ── Funciones ─────────────────────────────────────────────────────────────────

log()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*"; }
warn()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: $*"; }

sha256file() {
  sha256sum "$1" | cut -d' ' -f1
}

# ── Verificación inicial ─────────────────────────────────────────────────────

log "=== Restore All ==="
log ""

if ! command -v rclone &>/dev/null; then
  error "rclone no está instalado. Instálalo y configura el Service Account."
  exit 1
fi

if ! rclone listremotes 2>/dev/null | grep -q 'gdrive-backups:'; then
  error "rclone remote 'gdrive-backups:' no encontrado."
  error "Ejecuta: rclone config create gdrive-backups drive ..."
  error "Ver docs/deploy/SETUP_GOOGLE_DRIVE_BACKUP.md"
  exit 1
fi

# ── Descargar backup desde Google Drive ──────────────────────────────────────

log "Descargando backup '${RESTORE_DATE}' desde Google Drive..."
mkdir -p "$RESTORE_TARGET"

REMOTE_PATH="${GDRIVE_DEST}/${RESTORE_DATE}"

if $DRY_RUN; then
  log "[DRY-RUN] rclone copy ${REMOTE_PATH} ${RESTORE_TARGET}"
  rclone ls "${REMOTE_PATH}"
  exit 0
fi

rclone copy "${REMOTE_PATH}/" "${RESTORE_TARGET}/" \
  --verbose \
  --checksum 2>&1 | while IFS= read -r line; do log "  rclone: ${line}"; done

log "  Descarga completada en ${RESTORE_TARGET}"

# ── Verificar manifiesto ─────────────────────────────────────────────────────

MANIFEST="${RESTORE_TARGET}/manifest.json"

if [ ! -f "$MANIFEST" ]; then
  error "No se encontró manifest.json en ${RESTORE_TARGET}."
  error "El backup de '${RESTORE_DATE}' podría no existir o estar corrupto."
  exit 1
fi

log "Manifiesto encontrado. Verificando integridad..."

BACKUP_DATE=$(jq -r '.backup.date_str' "$MANIFEST")
BACKUP_APP_VER=$(jq -r '.backup.app_version' "$MANIFEST")
PG_SHA256=$(jq -r '.components.postgres.sha256' "$MANIFEST")
STORAGE_SHA256=$(jq -r '.components.storage.sha256' "$MANIFEST")
CONFIG_SHA256=$(jq -r '.components.config.sha256' "$MANIFEST")

log "  Backup del: ${BACKUP_DATE} (app: ${BACKUP_APP_VER})"

# Verificar checksums
VERIFY_FAILED=false

verify_file() {
  local file="$1"
  local expected_sha="$2"
  local name="$3"

  if [ ! -f "$file" ]; then
    error "  ${name}: ARCHIVO FALTANTE: ${file}"
    VERIFY_FAILED=true
    return
  fi

  local actual_sha
  actual_sha=$(sha256file "$file")

  if [ "$actual_sha" != "$expected_sha" ]; then
    error "  ${name}: CHECKSUM FAILED"
    error "    Esperado: ${expected_sha}"
    error "    Obtenido: ${actual_sha}"
    VERIFY_FAILED=true
  else
    log "  ${name}: ✓ Checksum OK"
  fi
}

verify_file "${RESTORE_TARGET}/postgres.dump" "$PG_SHA256" "PostgreSQL"
verify_file "${RESTORE_TARGET}/storage.tar.gz" "$STORAGE_SHA256" "Storage"
verify_file "${RESTORE_TARGET}/env-config.tar.gz" "$CONFIG_SHA256" "Config"

if $VERIFY_FAILED; then
  error "=== VERIFICACIÓN FALLÓ ==="
  error "El backup está corrupto. No se procederá con la restauración."
  exit 2
fi

log "  Integridad: ✓ Todos los checksums verificados"

if $VERIFY_ONLY; then
  log "=== VERIFICACIÓN COMPLETADA (--verify-only) ==="
  exit 0
fi

# ── Restaurar PostgreSQL ─────────────────────────────────────────────────────

if ! $SKIP_PG; then
  log ""
  log "=== Restaurando PostgreSQL ==="

  PG_FILE="${RESTORE_TARGET}/postgres.dump"

  if [ ! -f "$PG_FILE" ]; then
    warn "Archivo postgres.dump no encontrado. Omitiendo."
  else
    # Intentar detectar DATABASE_URL
    PG_URL="${DATABASE_URL:-}"

    if [ -z "$PG_URL" ] && [ -f "${RESTORE_TARGET}/.env" ]; then
      PG_URL=$(grep -oP '^DATABASE_URL=\K.*' "${RESTORE_TARGET}/.env" 2>/dev/null || echo "")
    fi

    if [ -n "$PG_URL" ]; then
      log "  Conectando a base de datos..."

      # Crear base si no existe
      DB_NAME=$(echo "$PG_URL" | grep -oP '[^/]+$')
      psql "$PG_URL" -c "SELECT 1" &>/dev/null && DB_EXISTS=true || DB_EXISTS=false

      log "  Restaurando con pg_restore (puede tomar varios minutos)..."

      # Validar estructura del dump antes del --clean destructivo
      if ! pg_restore --list "$PG_FILE" > /dev/null 2>&1; then
        error "El dump postgres.dump está corrupto o truncado."
        error "NO se procederá con la restauración destructiva."
        exit 1
      fi

      pg_restore --clean --if-exists --no-owner --no-acl \
        --dbname="$PG_URL" \
        --verbose \
        "$PG_FILE" 2>&1 | while IFS= read -r line; do log "  pg_restore: ${line}"; done

      log "  PostgreSQL restaurado correctamente."
      _PG_RESTORED=true
    else
      warn "  DATABASE_URL no detectada. No se restauró PostgreSQL."
      warn "  Para restaurar manualmente:"
      warn "    pg_restore --clean --no-owner --dbname='<URL>' ${PG_FILE}"
      _PG_RESTORED=false
    fi
  fi
else
  log "  PostgreSQL: omitido (--skip-pg)"
  _PG_SKIPPED=true
fi

# Guard: abortar si PostgreSQL no se restauró y no se omitió explícitamente
if [ "${_PG_RESTORED:-false}" = false ] && [ "${_PG_SKIPPED:-false}" != true ]; then
  error "PostgreSQL NO fue restaurado. Abortando para evitar un falso éxito."
  error "Verifica que DATABASE_URL esté configurada o usa --skip-pg para omitir."
  exit 3
fi

# ── Restaurar Storage ────────────────────────────────────────────────────────

if ! $SKIP_STORAGE; then
  log ""
  log "=== Restaurando Storage ==="

  STORAGE_FILE="${RESTORE_TARGET}/storage.tar.gz"

  if [ ! -f "$STORAGE_FILE" ]; then
    warn "  storage.tar.gz no encontrado. Omitiendo."
  else
    # Verificar que no está vacío
    if [ -s "$STORAGE_FILE" ]; then
      # Extraer en el directorio destino
      mkdir -p "$STORAGE_PATH"
      log "  Extrayendo en ${STORAGE_PATH}..."

      tar -xzf "$STORAGE_FILE" -C "$(dirname "$STORAGE_PATH")" 2>&1 | while IFS= read -r line; do log "  tar: ${line}"; done

      # Asegurar permisos
      STORAGE_OWNER="${STORAGE_OWNER:-nextjs:nodejs}"
      chown -R "$STORAGE_OWNER" "$STORAGE_PATH" 2>/dev/null || true

      log "  Storage restaurado en ${STORAGE_PATH}"
    else
      log "  storage.tar.gz está vacío (sin datos de storage)"
    fi
  fi
else
  log "  Storage: omitido (--skip-storage)"
fi

# ── Restaurar Config ─────────────────────────────────────────────────────────

if ! $SKIP_CONFIG; then
  log ""
  log "=== Restaurando Configuración ==="

  CONFIG_FILE="${RESTORE_TARGET}/env-config.tar.gz"

  if [ ! -f "$CONFIG_FILE" ]; then
    warn "  env-config.tar.gz no encontrado. Omitiendo."
  else
    CONFIG_TMP=$(mktemp -d)
    tar -xzf "$CONFIG_FILE" -C "$CONFIG_TMP" 2>&1

    # Restaurar .env si existe
    if [ -f "${CONFIG_TMP}/.env" ] && [ ! -f "$ENV_TARGET" ]; then
      cp "${CONFIG_TMP}/.env" "$ENV_TARGET"
      chmod 600 "$ENV_TARGET"
      log "  .env restaurado en ${ENV_TARGET}"
    elif [ -f "${CONFIG_TMP}/.env" ]; then
      warn "  ${ENV_TARGET} ya existe. NO se sobrescribió."
      warn "  Revisa manualmente si necesitas actualizarlo."
    fi

    # Copiar también .env a RESTORE_TARGET para que la detección de
    # DATABASE_URL en el paso PostgreSQL funcione automáticamente (H-04 fix)
    if [ -f "${CONFIG_TMP}/.env" ]; then
      cp "${CONFIG_TMP}/.env" "${RESTORE_TARGET}/.env"
    fi

    # Restaurar configuración de rclone
    if [ -f "${CONFIG_TMP}/rclone.conf" ]; then
      RCLONE_DEFAULT="${HOME}/.config/rclone/rclone.conf"
      RCLONE_DIR=$(dirname "${RCLONE_CONFIG:-${RCLONE_DEFAULT}}")
      mkdir -p "$RCLONE_DIR"
      cp "${CONFIG_TMP}/rclone.conf" "${RCLONE_DIR}/rclone.conf"
      chmod 600 "${RCLONE_DIR}/rclone.conf"
      log "  rclone.conf: restaurado en ${RCLONE_DIR}/rclone.conf"
    else
      warn "  rclone.conf no encontrado en el backup"
    fi

    # Restaurar Service Account JSON
    if [ -f "${CONFIG_TMP}/gdrive-service-account.json" ]; then
      SA_DIR="/srv/bodega/secrets"
      mkdir -p "$SA_DIR"
      cp "${CONFIG_TMP}/gdrive-service-account.json" "${SA_DIR}/gdrive-service-account.json"
      chmod 600 "${SA_DIR}/gdrive-service-account.json"
      log "  Service Account: restaurado en ${SA_DIR}/gdrive-service-account.json"

      # Verificar conectividad con Drive post-restauración
      if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q 'gdrive-backups:'; then
        log "  Verificando conectividad con Google Drive..."
        if rclone lsd "gdrive-backups:bodega-backups/" 2>/dev/null; then
          log "  ✓ Conectividad Drive OK"
        else
          warn "  No se pudo conectar a Google Drive después de restaurar el SA."
          warn "  Revisa docs/deploy/SETUP_GOOGLE_DRIVE_BACKUP.md — sección 'Solución de problemas'"
        fi
      fi
    else
      warn "  Service Account JSON no encontrado en el backup"
    fi

    # Mostrar info del sistema
    if [ -f "${CONFIG_TMP}/system-info.json" ]; then
      log "  Información del sistema del backup:"
      jq '.' "${CONFIG_TMP}/system-info.json" | while IFS= read -r line; do log "    ${line}"; done
    fi

    rm -rf "$CONFIG_TMP"
  fi
else
  log "  Config: omitido (--skip-config)"
fi

# ── Finalización ──────────────────────────────────────────────────────────────

log ""
log "=== Restauración COMPLETADA ==="
log "  Fecha:     ${RESTORE_DATE}"
log "  App vers:  ${BACKUP_APP_VER}"
log "  Destino:   ${RESTORE_TARGET}"
log ""

log "Próximos pasos:"
log "  1. Verificar que los contenedores Docker estén corriendo:"
log "     docker compose ps"
log ""
log "  2. Revisar healthcheck:"
log "     curl -f http://localhost:3000/api/health"
log ""
log "  3. Verificar que el Service Account JSON esté en su lugar:"
log "     ls -la /srv/bodega/secrets/gdrive-service-account.json"
log "     → Si no aparece, sácalo del password manager"
log ""
log "  4. Si restauraste en un servidor nuevo, ajusta .env con las"
log "     credenciales correctas (AUTH_SECRET, etc.)"
log ""
log "  5. Ejecutar migraciones si la versión de la app es más nueva:"
log "     docker compose run --rm migrate"
log ""

exit 0
