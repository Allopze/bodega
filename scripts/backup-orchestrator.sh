#!/usr/bin/env bash
set -euo pipefail

# ── Backup Orchestrator ───────────────────────────────────────────────────────
# Orquesta el backup completo del sistema:
#   1. PostgreSQL  (pg_dump -Fc, comprimido)
#   2. Storage     (adjuntos, tar + gzip)
#   3. Config      (.env + metadatos del sistema)
#   4. Manifiesto  (checksums SHA-256, metadatos, fechas)
#   5. Upload      (a Google Drive vía rclone)
#   6. Limpieza    (retención local + remota)
#
# Usage:
#   ./scripts/backup-orchestrator.sh                    # defaults
#   BACKUP_DIR=/custom/backups ./scripts/backup-orchestrator.sh
#   GDRIVE_DEST=gdrive-backups:bodega-backups ./scripts/backup-orchestrator.sh
#
# Cron recomendado (después del horario laboral chileno):
#   0 3 * * * /srv/bodega/scripts/backup-orchestrator.sh >> /var/log/bodega-backup.log 2>&1
# ──────────────────────────────────────────────────────────────────────────────

# ── Configuración ─────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/srv/bodega/backups}"
TIMESTAMP="$(date '+%Y-%m-%d-%H%M%S')"
DATE_STR="$(date '+%Y-%m-%d')"
SNAPSHOT_DIR="${BACKUP_DIR}/snapshots/${DATE_STR}"
LOCAL_PG_DIR="${BACKUP_DIR}/pg"
LOCAL_STORAGE_BACKUP="${BACKUP_DIR}/storage"
GDRIVE_DEST="${GDRIVE_DEST:-gdrive-backups:bodega-backups}"
STORAGE_PATH="${STORAGE_PATH:-/srv/bodega/storage}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
LOG_FILE="${LOG_FILE:-/var/log/bodega-backup.log}"
APP_VERSION="${APP_VERSION:-$(git describe --tags --always 2>/dev/null || echo 'unknown')}"

# Rutas de secrets de rclone (se incluyen en el backup de configuración)
RCLONE_CONFIG_PATH="${RCLONE_CONFIG:-${HOME}/.config/rclone/rclone.conf}"
SA_SEARCH_PATHS=(
  "/srv/bodega/secrets/gdrive-service-account.json"
  "${HOME}/.config/rclone/gdrive-service-account.json"
)

# ── Funciones ─────────────────────────────────────────────────────────────────

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error() { log "ERROR: $*"; }
warn()  { log "WARN: $*"; }

# Variable global para directorio temporal de config (lo limpia cleanup)
_CONFIG_TMP=""
# Variable global para trackear el paso que falló
_FAILED_STEP=""

cleanup() {
  local exit_code=$?

  # Limpiar directorio temporal si existe
  if [ -n "$_CONFIG_TMP" ] && [ -d "$_CONFIG_TMP" ]; then
    rm -rf "$_CONFIG_TMP" 2>/dev/null || true
  fi

  if [ $exit_code -ne 0 ]; then
    error "Backup FAILED with exit code $exit_code"
    if [ -n "$_FAILED_STEP" ]; then
      error "  Failed at step: ${_FAILED_STEP}"
    fi
    # Dejar rastro para monitoreo
    echo "BACKUP_STATUS=FAILED" > "${BACKUP_DIR}/.backup-status"
    echo "BACKUP_ERROR=exit_code_${exit_code}" >> "${BACKUP_DIR}/.backup-status"
    echo "BACKUP_FAILED_STEP=${_FAILED_STEP:-unknown}" >> "${BACKUP_DIR}/.backup-status"
  fi
  exit $exit_code
}
trap cleanup EXIT

sha256file() {
  sha256sum "$1" | cut -d' ' -f1
}

bytes() {
  wc -c < "$1" | tr -d ' '
}

# ── Preparación ───────────────────────────────────────────────────────────────

log "=== Backup Orchestrator ==="
log "Iniciando backup del ${DATE_STR} (versión: ${APP_VERSION})"
log ""

mkdir -p "${SNAPSHOT_DIR}" "${LOCAL_PG_DIR}" "${LOCAL_STORAGE_BACKUP}"

# Inicializar manifiesto
MANIFEST="${SNAPSHOT_DIR}/manifest.json"
cat > "$MANIFEST" <<MANIFEST_EOF
{
  "backup": {
    "date": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
    "date_str": "${DATE_STR}",
    "timestamp": "${TIMESTAMP}",
    "app_version": "${APP_VERSION}",
    "hostname": "$(hostname)",
    "tool": "backup-orchestrator.sh"
  },
  "components": {},
  "checksums": {},
  "sizes": {}
}
MANIFEST_EOF

INITIAL_SIZE=$(stat -c%s "$MANIFEST" 2>/dev/null || stat -f%z "$MANIFEST" 2>/dev/null)

# ── 1. PostgreSQL Backup ─────────────────────────────────────────────────────

log "[1/4] Realizando backup de PostgreSQL..."
_FAILED_STEP="pg_dump"

PG_FILE="${SNAPSHOT_DIR}/postgres.dump"
PG_FILE_SHA256=""

if [ -z "${DATABASE_URL:-}" ]; then
  warn "DATABASE_URL no está definida. Buscando en .env..."
  if [ -f "/srv/bodega/.env" ]; then
    set -a; source /srv/bodega/.env; set +a
  fi
fi

if [ -z "${DATABASE_URL:-}" ]; then
  error "DATABASE_URL es requerida. No se puede continuar."
  exit 1
fi

pg_dump "${DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --verbose \
  --file="${PG_FILE}" 2>&1 | while IFS= read -r line; do log "  pg_dump: ${line}"; done

PG_SIZE=$(bytes "$PG_FILE")
PG_SHA256=$(sha256file "$PG_FILE")

# También guardar una copia en el directorio de backups rotativos
cp "$PG_FILE" "${LOCAL_PG_DIR}/bodega-${TIMESTAMP}.dump"
ln -sf "bodega-${TIMESTAMP}.dump" "${LOCAL_PG_DIR}/bodega-latest.dump"

log "  PostgreSQL: ${PG_SIZE} bytes | SHA256: ${PG_SHA256}"

# ── 2. Storage Backup ────────────────────────────────────────────────────────

log "[2/4] Comprimiendo storage..."
_FAILED_STEP="storage_tar"

STORAGE_FILE="${SNAPSHOT_DIR}/storage.tar.gz"

if [ -d "$STORAGE_PATH" ]; then
  tar -czf "$STORAGE_FILE" \
    --exclude='.health-*.tmp' \
    -C "$(dirname "$STORAGE_PATH")" \
    "$(basename "$STORAGE_PATH")" 2>&1

  STORAGE_SIZE=$(bytes "$STORAGE_FILE")
  STORAGE_SHA256=$(sha256file "$STORAGE_FILE")
  log "  Storage: ${STORAGE_SIZE} bytes | SHA256: ${STORAGE_SHA256}"
else
  warn "STORAGE_PATH (${STORAGE_PATH}) no existe. Storage se omite."
  STORAGE_SIZE=0
  STORAGE_SHA256=""
  touch "$STORAGE_FILE"  # archivo vacío para consistencia
fi

# ── 3. Environment / Config Backup ───────────────────────────────────────────

log "[3/4] Respaldando configuración del sistema..."
_FAILED_STEP="config_backup"

CONFIG_FILE="${SNAPSHOT_DIR}/env-config.tar.gz"

# Crear directorio temporal para config
_CONFIG_TMP=$(mktemp -d)

# ── Respaldar .env ──────────────────────────────────────────────────────────
# En producción Docker las vars vienen del environment: no hay archivo físico.
# Por eso primero se intenta el archivo y, si no existe, se genera desde las
# variables de entorno del proceso usando una whitelist de vars conocidas.

# Variables de entorno conocidas que se incluyen en el .env generado
ENV_WHITELIST=(
  NODE_ENV HOSTNAME
  DATABASE_URL POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD PGHOST
  AUTH_SECRET AUTH_SECRET_PREVIOUS AUTH_URL NEXTAUTH_URL
  APP_URL PDF_RENDER_ORIGIN
  RESEND_API_KEY
  STORAGE_PATH BACKUP_DIR BACKUP_SCRIPTS_PATH
  GDRIVE_BACKUPS_DEST RETENTION_DAYS
  CRON_SECRET
  COPEC_USERNAME COPEC_PASSWORD COPEC_SYNC_START_DATE
  TAX_RATE PDF_MAX_CONCURRENT PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  TAE_OCR_MAX_CONCURRENT
  SENTRY_DSN NEXT_PUBLIC_SENTRY_DSN
  E2E_DATABASE_URL
)

if [ -f "/srv/bodega/.env" ]; then
  cp /srv/bodega/.env "${_CONFIG_TMP}/.env"
  ENV_SOURCE="physical_file"
  log "  .env: respaldado desde archivo físico (/srv/bodega/.env)"
else
  # En Docker las vars vienen del environment, no hay archivo.
  # Generamos .env desde las variables de entorno del proceso.
  ENV_SOURCE="process_env"
  log "  .env: generando desde variables de entorno del proceso..."
  {
    echo "# Generado por backup-orchestrator.sh desde variables de entorno"
    echo "# Fecha: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo ""
    for var_name in "${ENV_WHITELIST[@]}"; do
      var_value="${!var_name:-}"
      if [ -n "$var_value" ]; then
        printf '%s=%s\n' "$var_name" "$var_value"
      fi
    done
  } > "${_CONFIG_TMP}/.env"
  log "  .env: generado con whitelist de ${#ENV_WHITELIST[@]} variables"
fi

# Respaldar configuración de rclone (necesaria para restore desde Drive)
if [ -f "$RCLONE_CONFIG_PATH" ]; then
  cp "$RCLONE_CONFIG_PATH" "${_CONFIG_TMP}/rclone.conf"
  HAS_RCLONE_CONF="true"
  log "  rclone.conf: respaldado (${RCLONE_CONFIG_PATH})"
else
  HAS_RCLONE_CONF="false"
  warn "  rclone.conf no encontrado en ${RCLONE_CONFIG_PATH}"
fi

# Respaldar Service Account JSON de Google Drive
HAS_SA="false"
for sa_path in "${SA_SEARCH_PATHS[@]}"; do
  if [ -f "$sa_path" ]; then
    cp "$sa_path" "${_CONFIG_TMP}/gdrive-service-account.json"
    HAS_SA="true"
    log "  Service Account: respaldado (${sa_path})"
    break
  fi
done
if [ "$HAS_SA" = "false" ]; then
  warn "  Service Account JSON no encontrado (buscado en: ${SA_SEARCH_PATHS[*]})"
fi

# Metadata del sistema
cat > "${_CONFIG_TMP}/system-info.json" <<SYSINFO
{
  "hostname": "$(hostname)",
  "kernel": "$(uname -r)",
  "date": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "docker_version": "$(docker --version 2>/dev/null || echo 'N/A')",
  "node_version": "$(node --version 2>/dev/null || echo 'N/A')",
  "app_version": "${APP_VERSION}",
  "pg_version": "$(pg_dump --version 2>/dev/null || echo 'N/A')",
  "rclone_version": "$(rclone version 2>/dev/null | head -1 || echo 'N/A')"
}
SYSINFO

# Lista de volúmenes Docker
docker inspect bodega-db --format '{{json .Mounts}}' 2>/dev/null > "${_CONFIG_TMP}/docker-volumes.json" || true
docker inspect bodega-storage --format '{{json .Mounts}}' 2>/dev/null >> "${_CONFIG_TMP}/docker-volumes.json" || true

tar -czf "$CONFIG_FILE" -C "$_CONFIG_TMP" . 2>&1
# cleanup() lo eliminará al salir

CONFIG_SIZE=$(bytes "$CONFIG_FILE")
CONFIG_SHA256=$(sha256file "$CONFIG_FILE")
log "  Config: ${CONFIG_SIZE} bytes | SHA256: ${CONFIG_SHA256}"

# ── 4. Ensamblar manifiesto final ────────────────────────────────────────────

log "[4/4] Generando manifiesto de backup..."

cat > "$MANIFEST" <<MANIFEST_EOF
{
  "backup": {
    "date": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
    "date_str": "${DATE_STR}",
    "timestamp": "${TIMESTAMP}",
    "app_version": "${APP_VERSION}",
    "hostname": "$(hostname)",
    "tool": "backup-orchestrator.sh",
    "retention_days": ${RETENTION_DAYS}
  },
  "components": {
    "postgres": {
      "file": "postgres.dump",
      "size_bytes": ${PG_SIZE},
      "sha256": "${PG_SHA256}",
      "format": "pg_dump custom (Fc)",
      "compression": "built-in (zlib level 9)"
    },
    "storage": {
      "file": "storage.tar.gz",
      "size_bytes": ${STORAGE_SIZE},
      "sha256": "${STORAGE_SHA256}",
      "format": "tar.gz"
    },
    "config": {
      "file": "env-config.tar.gz",
      "size_bytes": ${CONFIG_SIZE},
      "sha256": "${CONFIG_SHA256}",
      "format": "tar.gz",
      "includes": {
        "env_source": "${ENV_SOURCE}",
        "docker_volumes": true,
        "system_info": true,
        "rclone_conf": ${HAS_RCLONE_CONF},
        "gdrive_service_account": ${HAS_SA}
      }
    }
  },
  "total_size_bytes": $((PG_SIZE + STORAGE_SIZE + CONFIG_SIZE)),
  "integrity": {
    "manifest_sha256": "",
    "verified_at": null
  }
}
MANIFEST_EOF

# Auto-checksum del manifiesto
MANIFEST_SHA256=$(sha256file "$MANIFEST")
# Insertar checksum del manifiesto en sí mismo (re-escribir)
# NOTA: el SHA final del backup se calcula externamente
MANIFEST_SIZE=$(bytes "$MANIFEST")
log "  Manifiesto: ${MANIFEST_SIZE} bytes | SHA256: ${MANIFEST_SHA256}"

# ── 5. Upload a Google Drive ─────────────────────────────────────────────────

log ""
log "Subiendo a Google Drive..."
_FAILED_STEP="upload_drive"

UPLOAD_PATH="${GDRIVE_DEST}/${DATE_STR}"

# Verificar que rclone está configurado
if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q 'gdrive-backups:'; then
  log "  Destino: ${UPLOAD_PATH}"

  rclone copy "${SNAPSHOT_DIR}/" "${UPLOAD_PATH}/" \
    --verbose \
    --checksum \
    --progress 2>&1 | while IFS= read -r line; do log "  rclone: ${line}"; done

  # Actualizar symlink "latest" en Drive
  rclone delete "${GDRIVE_DEST}/latest" --quiet 2>/dev/null || true
  rclone copy "${SNAPSHOT_DIR}/manifest.json" "${GDRIVE_DEST}/latest/" --quiet

  log "  Upload completado."
else
  warn "  rclone/gdrive-backups no configurado. Backup solo LOCAL."
  warn "  Para configurar: sigue docs/deploy/SETUP_GOOGLE_DRIVE_BACKUP.md"
fi

# ── 6. Limpieza de backups locales antiguos ──────────────────────────────────

log ""
log "Limpiando backups antiguos..."
_FAILED_STEP="cleanup_local"

# PG rotativos (diarios, retención configurables)
find "${LOCAL_PG_DIR}" -name 'bodega-*.dump' -type f -mtime "+${RETENTION_DAYS}" \
  -exec rm -v {} \; 2>&1 | while IFS= read -r line; do log "  cleanup: ${line}"; done

# Snapshots locales (solo mantener los últimos N días)
find "${BACKUP_DIR}/snapshots" -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" \
  -exec rm -rfv {} \; 2>&1 | while IFS= read -r line; do log "  cleanup: ${line}"; done

# ── 7. Limpieza de backups remotos en Drive ──────────────────────────────────

if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q 'gdrive-backups:'; then
  log "Limpiando backups remotos antiguos..."
  _FAILED_STEP="cleanup_remote"

  cutoff_ts=$(date -d "-${RETENTION_DAYS} days" +%s)

  rclone lsd "${GDRIVE_DEST}/" 2>/dev/null | while IFS= read -r line; do
    # rclone lsd outputs: <size> <date> <time> <folder_name>
    # We extract the date+time and folder name from known positions
    folder_date=$(echo "$line" | awk 'NF>=4 {print $2}')
    folder_time=$(echo "$line" | awk 'NF>=4 {print $3}')
    folder_name=$(echo "$line" | awk 'NF>=4 {for(i=4;i<=NF;i++) printf "%s%s", $i, (i==NF?"\n":" ")}' | sed 's/ $//')

    if [ -z "$folder_date" ] || [ -z "$folder_name" ]; then
      continue
    fi

    # Validate folder name matches YYYY-MM-DD pattern before treating as backup date
    if ! echo "$folder_name" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
      continue
    fi

    folder_ts=$(date -d "${folder_date} ${folder_time}" +%s 2>/dev/null || echo 0)
    if [ "$folder_ts" -gt 0 ] && [ "$folder_ts" -lt "$cutoff_ts" ] && [ "$folder_name" != "latest" ]; then
      log "  Eliminando remoto: ${folder_name}"
      rclone purge "${GDRIVE_DEST}/${folder_name}" --quiet 2>/dev/null || true
    fi
  done
fi

# ── Finalización ──────────────────────────────────────────────────────────────

TOTAL_SIZE=$((PG_SIZE + STORAGE_SIZE + CONFIG_SIZE))
TOTAL_SIZE_HUMAN=$(numfmt --to=iec-i --suffix=B "$TOTAL_SIZE" 2>/dev/null || echo "${TOTAL_SIZE}B")

log ""
log "=== Backup COMPLETADO ==="
log "  Fecha:    ${DATE_STR}"
log "  Tamaño:   ${TOTAL_SIZE_HUMAN}"
log "  Postgres: ${PG_SIZE} bytes"
log "  Storage:  ${STORAGE_SIZE} bytes"
log "  Config:   ${CONFIG_SIZE} bytes"
log "  Manifiesto SHA256: ${MANIFEST_SHA256}"
log "  Drive:    ${UPLOAD_PATH}"
log ""

# Clear failed step on success
_FAILED_STEP=""

# Escribir estado para monitoreo
echo "BACKUP_STATUS=OK" > "${BACKUP_DIR}/.backup-status"
echo "BACKUP_DATE=${DATE_STR}" >> "${BACKUP_DIR}/.backup-status"
echo "BACKUP_MANIFEST_SHA256=${MANIFEST_SHA256}" >> "${BACKUP_DIR}/.backup-status"
echo "BACKUP_TOTAL_SIZE=${TOTAL_SIZE}" >> "${BACKUP_DIR}/.backup-status"

exit 0
