#!/usr/bin/env bash
set -euo pipefail

# ── Backup Orchestrator ───────────────────────────────────────────────────────
# Orquesta el backup completo del sistema:
#   1. PostgreSQL  (pg_dump -Fc, comprimido)
#   2. Storage     (adjuntos, tar + gzip)
#   3. Config      (.env + metadatos del sistema)
#   4. Manifiesto  (checksums SHA-256, metadatos, fechas)
#   5. Upload      (a Cloudreve vía WebDAV)
#   6. Limpieza    (retención local)
#
# Usage:
#   ./scripts/backup-orchestrator.sh                    # defaults
#   BACKUP_DIR=/custom/backups ./scripts/backup-orchestrator.sh
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
STORAGE_PATH="${STORAGE_PATH:-/srv/bodega/storage}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
LOG_FILE="${LOG_FILE:-/var/log/bodega-backup.log}"
APP_VERSION="${APP_VERSION:-$(git describe --tags --always 2>/dev/null || echo 'unknown')}"

# ── Funciones ─────────────────────────────────────────────────────────────────

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error() { log "ERROR: $*"; }
warn()  { log "WARN: $*"; }

# Variables globales para directorios temporales (los limpia cleanup)
_CONFIG_TMP=""
_UPLOAD_TMP=""
_CLOUDREVE_SST_TMP=""
_SST_STAGE=""
# Variable global para trackear el paso que falló
_FAILED_STEP=""

cleanup() {
  local exit_code=$?

  # Limpiar directorios temporales si existen
  if [ -n "$_CONFIG_TMP" ] && [ -d "$_CONFIG_TMP" ]; then
    rm -rf "$_CONFIG_TMP" 2>/dev/null || true
  fi
  if [ -n "$_UPLOAD_TMP" ] && [ -d "$_UPLOAD_TMP" ]; then
    rm -rf "$_UPLOAD_TMP" 2>/dev/null || true
  fi
  # Copias de los documentos SST: si el respaldo aborta a medio armar el tar,
  # no deben quedar en el temporal.
  for _tmp in "$_CLOUDREVE_SST_TMP" "$_SST_STAGE"; do
    if [ -n "$_tmp" ] && [ -d "$_tmp" ]; then
      rm -rf "$_tmp" 2>/dev/null || true
    fi
  done

  if [ $exit_code -ne 0 ]; then
    error "Backup FAILED with exit code $exit_code"
    if [ -n "$_FAILED_STEP" ]; then
      error "  Failed at step: ${_FAILED_STEP}"
    fi
    # Dejar rastro para monitoreo. BACKUP_RUN_ID lo fija quien invoca (el botón
    # o el scheduler) para no atribuirle a su corrida el estado de otra.
    {
      echo "BACKUP_STATUS=FAILED"
      echo "BACKUP_RUN_ID=${BACKUP_RUN_ID:-}"
      echo "BACKUP_DATE=${DATE_STR}"
      echo "BACKUP_ERROR=exit_code_${exit_code}"
      echo "BACKUP_FAILED_STEP=${_FAILED_STEP:-unknown}"
    } > "${BACKUP_DIR}/.backup-status"
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

# ── 0. Precondición: el storage no está vacío ────────────────────────────────
# PREV-I13-D: un volumen de storage que no montó (vacío o ausente) producía un
# respaldo "OK" sin un solo archivo de evidencia, y con la retención de
# ${RETENTION_DAYS} días esos snapshots terminan reemplazando a los buenos. Se
# comprueba ANTES del pg_dump para no dejar un snapshot a medias que parezca
# completo. `BACKUP_ALLOW_EMPTY_STORAGE=true` es el escape explícito para una
# instalación nueva que todavía no tiene adjuntos.

_FAILED_STEP="storage_precondition"
STORAGE_SOURCE_FILES=0
if [ -d "$STORAGE_PATH" ]; then
  STORAGE_SOURCE_FILES=$(find "$STORAGE_PATH" -type f ! -name '.health-*.tmp' 2>/dev/null | wc -l | tr -d ' ')
fi
if [ "${STORAGE_SOURCE_FILES:-0}" -eq 0 ]; then
  if [ "${BACKUP_ALLOW_EMPTY_STORAGE:-false}" = "true" ]; then
    warn "STORAGE_PATH (${STORAGE_PATH}) está vacío o no existe; se continúa por BACKUP_ALLOW_EMPTY_STORAGE=true."
  else
    error "STORAGE_PATH (${STORAGE_PATH}) está vacío o no existe: ¿el volumen de storage no montó?"
    error "  No se respalda un storage vacío como si fuera bueno. Si es una instalación sin adjuntos,"
    error "  reintente con BACKUP_ALLOW_EMPTY_STORAGE=true."
    exit 1
  fi
else
  log "  Storage: ${STORAGE_SOURCE_FILES} archivos en ${STORAGE_PATH}"
fi

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

# Si los documentos SST viven en Cloudreve, el tar local ya no los contiene.
# Se descargan a un directorio temporal y se mezclan dentro del tar con la MISMA
# ruta relativa (`storage/sst-documents/`) para que restore-all.sh siga
# funcionando sin cambios. Si la descarga falla, el backup ABORTA: un backup
# "exitoso" sin los documentos DS 44 es un respaldo que miente.
# El backend activo lo decide la app con `system_settings` antes que con
# SST_STORAGE_BACKEND (lib/storage/sst-backend.ts). Mirar sólo la variable
# dejaba fuera del tar los documentos que la app guarda en Cloudreve cuando el
# backend se eligió desde Administración. Fuera de la imagen (sin el script
# empaquetado) queda la variable.
SST_BACKEND="${SST_STORAGE_BACKEND:-filesystem}"
SST_DOWNLOADER="${SST_DOWNLOADER:-/app/scripts/download-sst-documents.mjs}"
if [ -f "$SST_DOWNLOADER" ]; then
  if ! SST_BACKEND="$(node "$SST_DOWNLOADER" --print-backend | tail -n 1)"; then
    error "No se pudo determinar dónde viven los documentos SST. Backup abortado."
    exit 1
  fi
fi
log "  Documentos SST: backend ${SST_BACKEND}"

_CLOUDREVE_SST_TMP=""
if [ "${SST_BACKEND}" = "cloudreve" ]; then
  _CLOUDREVE_SST_TMP=$(mktemp -d)
  log "  Descargando documentos SST desde Cloudreve..."
  if ! node "$SST_DOWNLOADER" "${_CLOUDREVE_SST_TMP}"; then
    error "No se pudieron descargar los documentos SST desde Cloudreve. Backup abortado."
    rm -rf "${_CLOUDREVE_SST_TMP}"
    exit 1
  fi
fi

if [ -d "$STORAGE_PATH" ]; then
  if [ -n "${_CLOUDREVE_SST_TMP}" ]; then
    # Staging con copia real (no hardlinks: el volumen de Docker puede vivir en
    # otro filesystem) para que `tar -C` vea `storage/sst-documents/` con el
    # contenido fresco desde Cloudreve. El volumen real queda intacto.
    # cp sin -a no preserva timestamps pero evita fallar si el destino tiene
    # dueño distinto (volumen Docker); los contenidos son lo que importa.
    # En el temporal del sistema, no junto al storage: en prod el padre
    # (/data) es de root y el proceso corre como nextjs, así que el mktemp
    # fallaba y el respaldo abortaba en storage_tar sin decir por qué.
    _SST_STAGE=$(mktemp -d)
    cp -a "$STORAGE_PATH" "${_SST_STAGE}/storage" 2>/dev/null || cp -r "$STORAGE_PATH" "${_SST_STAGE}/storage"
    rm -rf "${_SST_STAGE}/storage/sst-documents"
    mkdir -p "${_SST_STAGE}/storage/sst-documents"
    cp -a "${_CLOUDREVE_SST_TMP}/." "${_SST_STAGE}/storage/sst-documents/" 2>/dev/null || cp -r "${_CLOUDREVE_SST_TMP}/." "${_SST_STAGE}/storage/sst-documents/"
    tar -czf "$STORAGE_FILE" \
      --exclude='.health-*.tmp' \
      -C "${_SST_STAGE}" \
      "storage" 2>&1
    rm -rf "${_SST_STAGE}" "${_CLOUDREVE_SST_TMP}"
  else
    tar -czf "$STORAGE_FILE" \
      --exclude='.health-*.tmp' \
      -C "$(dirname "$STORAGE_PATH")" \
      "$(basename "$STORAGE_PATH")" 2>&1
  fi

  STORAGE_SIZE=$(bytes "$STORAGE_FILE")
  STORAGE_SHA256=$(sha256file "$STORAGE_FILE")
  # PREV-I13-D: cuántos archivos trae el tar (no el directorio: incluye los
  # documentos SST bajados de Cloudreve). El ensayo de restauración lo compara
  # con lo que `tar -tzf` lista.
  STORAGE_FILE_COUNT=$(tar -tzf "$STORAGE_FILE" | grep -vc '/$' || true)
  log "  Storage: ${STORAGE_SIZE} bytes | ${STORAGE_FILE_COUNT} archivos | SHA256: ${STORAGE_SHA256}"
else
  warn "STORAGE_PATH (${STORAGE_PATH}) no existe. Storage se omite."
  STORAGE_SIZE=0
  STORAGE_SHA256=""
  STORAGE_FILE_COUNT=0
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

# Variables de entorno conocidas que se incluyen en el .env generado.
#
# DEBE cubrir TODAS las que docker-compose.yml inyecta al servicio `app`:
# scripts/backup-env-whitelist.test.ts falla si el compose gana una variable
# que esta lista no guarda. Faltaba DTE_SETTINGS_KEYRING, o sea que el respaldo
# guardaba los sobres `enc:v1:` del dump y tiraba la llave que los abre: un
# restore dejaba las credenciales del portal y de Chipax ilegibles para siempre.
#
# NUNCA agregar acá BACKUP_ENCRYPTION_PASSPHRASE: es la clave con la que se
# cifra este mismo snapshot y viajaría dentro de lo que protege.
ENV_WHITELIST=(
  NODE_ENV HOSTNAME TZ
  DATABASE_URL POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD PGHOST
  AUTH_SECRET AUTH_SECRET_PREVIOUS AUTH_URL NEXTAUTH_URL NEXTAUTH_SECRET
  PREVENTION_DATA_ENCRYPTION_KEY PREVENTION_DATA_ENCRYPTION_KEY_VERSION
  # PREV-M06: vigencia del enlace de acuse y su ventana de transición; un
  # restore debe emitir enlaces con el mismo plazo que antes.
  PREVENTION_ACK_TTL_DAYS PREVENTION_ACK_LEGACY_UNTIL
  APP_URL PDF_RENDER_ORIGIN
  RESEND_API_KEY
  STORAGE_PATH BACKUP_DIR BACKUP_SCRIPTS_PATH
  RETENTION_DAYS
  CRON_SECRET CRON_ALLOWED_SOURCES FLEET_GPS_CRON_INTERNAL_SECRET
  # W5-GC (D13): si el borrado real del GC de evidencia estaba encendido, un
  # restore debe dejarlo igual (y no volver en silencio al modo de prueba).
  PDTP_EVIDENCE_GC_DELETE
  COPEC_USERNAME COPEC_PASSWORD COPEC_SYNC_START_DATE COPEC_SYNC_IMPORTER_EMAIL
  # Desde 2026-10 el portal pide un código por correo: sin la casilla IMAP un
  # restore deja el sync de Copec sin poder iniciar sesión.
  COPEC_OTP_IMAP_HOST COPEC_OTP_IMAP_PORT COPEC_OTP_IMAP_USER COPEC_OTP_IMAP_PASSWORD
  # Aramco Fleet (Esmax): mismo caso que Copec. Lo normal es que las
  # credenciales vivan cifradas en `system_settings`, pero estas variables son
  # su respaldo, y sin ellas un dump restaurado en una máquina sin keyring se
  # queda sin forma de volver a sincronizar.
  ARAMCO_DOCUMENT_NUMBER ARAMCO_PASSWORD ARAMCO_SYNC_ENABLED ARAMCO_SYNC_IMPORTER_EMAIL
  ONWAY_USERNAME ONWAY_PASSWORD ONWAY_SYNC_ENABLED
  # Cloudreve (storage de documentos SST): la URL y el backend son configuración
  # funcional; las credenciales son el respaldo del .env del servidor (las
  # cifradas viven en system_settings y viajan en el dump PG). Mismo caso que
  # Aramco/Copec: sin ellas un restore se queda sin acceso al WebDAV.
  SST_STORAGE_BACKEND CLOUDREVE_BASE_URL CLOUDREVE_USERNAME CLOUDREVE_PASSWORD
  CLOUDREVE_SST_PATH CLOUDREVE_REQUEST_TIMEOUT_MS
  # Llave que habilita archivar documentos generados en Cloudreve: un restore
  # en producción debe quedar con el archivado habilitado igual que antes.
  GENERATED_DOCS_ARCHIVE_ENABLED
  TAX_RATE PDF_MAX_CONCURRENT PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  TAE_OCR_MAX_CONCURRENT
  SENTRY_DSN NEXT_PUBLIC_SENTRY_DSN SENTRY_ENVIRONMENT
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  E2E_DATABASE_URL
  # Portal DTE: la llave del keyring y las credenciales legacy. Sin la llave el
  # dump restaurado es indescifrable (`encryption_mode=encrypted_only` sobrevive
  # al dump y prohíbe el fallback al .env).
  DTE_SETTINGS_KEYRING DTE_SETTINGS_ACTIVE_KEY_ID DTE_SETTINGS_MODE
  DTE_PORTAL_BASE_URL DTE_PORTAL_RUT_USR DTE_PORTAL_RUT_EMP
  DTE_PORTAL_CLAVE DTE_PORTAL_CODEMP
  DTE_SYNC_ENABLED DTE_SYNC_IMPORTER_EMAIL DTE_SYNC_DELAY_MS
  # Facturación y Chipax: flags y credenciales de la API financiera.
  BILLING_SALES_SYNC_ENABLED BILLING_HISTORY_FLOOR
  BILLING_MATCH_AMOUNT_TOLERANCE_CLP BILLING_MATCH_DATE_WINDOW_DAYS
  BILLING_COMPANY_TAX_ID BILLING_CHIPAX_ENABLED BILLING_CHIPAX_SYNC_ENABLED
  CHIPAX_OPENAPI_URL CHIPAX_API_BASE_URL CHIPAX_APP_ID CHIPAX_SECRET_KEY
  CHIPAX_REQUEST_TIMEOUT_MS
)

if [ -f "/srv/bodega/.env" ]; then
  # Copia FILTRADA, no `cp`: si la passphrase de cifrado vive en el archivo
  # físico, un `cp` la metía dentro del tar que ella misma cifra — la llave
  # viajando junto al candado. La whitelist de arriba ya la excluye en la otra
  # rama; acá hay que quitarla a mano.
  grep -Ev '^[[:space:]]*(export[[:space:]]+)?BACKUP_ENCRYPTION_PASSPHRASE=' \
    /srv/bodega/.env > "${_CONFIG_TMP}/.env" || true
  chmod 600 "${_CONFIG_TMP}/.env"
  ENV_SOURCE="physical_file"
  log "  .env: respaldado desde archivo físico (/srv/bodega/.env, sin la passphrase de cifrado)"
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

# Metadata del sistema
cat > "${_CONFIG_TMP}/system-info.json" <<SYSINFO
{
  "hostname": "$(hostname)",
  "kernel": "$(uname -r)",
  "date": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "docker_version": "$(docker --version 2>/dev/null || echo 'N/A')",
  "node_version": "$(node --version 2>/dev/null || echo 'N/A')",
  "app_version": "${APP_VERSION}",
  "pg_version": "$(pg_dump --version 2>/dev/null || echo 'N/A')"
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

# Se resuelve en el paso de subida; acá sólo se declara para el manifiesto.
SNAPSHOT_ENCRYPTED="$([ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] && echo true || echo false)"

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
      "file_count": ${STORAGE_FILE_COUNT:-0},
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
        "system_info": true
      }
    }
  },
  "total_size_bytes": $((PG_SIZE + STORAGE_SIZE + CONFIG_SIZE)),
  "upload": {
    "encrypted": ${SNAPSHOT_ENCRYPTED:-false},
    "note": "Si encrypted=true los archivos remotos llevan sufijo .gpg y los sha256 son los del archivo en claro."
  },
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

# ── 5. Upload al destino remoto (Cloudreve) ──────────────────────────────────

log ""
log "Subiendo a destinos remotos..."
_FAILED_STEP="upload_remote"

CLOUDREVE_UPLOADED="false"

# ── Cifrado del snapshot antes de salir del host ─────────────────────────────
# El dump lleva los sobres `enc:v1:` y el .env generado lleva la llave que los
# abre: subirlos en claro anula el cifrado de `settings-crypto.ts`. Con
# BACKUP_ENCRYPTION_PASSPHRASE definida (fuera del snapshot: no está en la
# whitelist) se sube `*.gpg` en vez de los archivos planos. El manifiesto viaja
# en claro a propósito: sólo tiene checksums y es lo que el restore lee primero.
UPLOAD_SRC="${SNAPSHOT_DIR}"
SNAPSHOT_ENCRYPTED="false"

if [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  _FAILED_STEP="encrypt_snapshot"
  if ! command -v gpg &>/dev/null; then
    error "BACKUP_ENCRYPTION_PASSPHRASE está definida pero gpg no está instalado."
    error "  Instale gnupg o quite la variable; no se sube un snapshot en claro por omisión."
    exit 1
  fi
  _UPLOAD_TMP=$(mktemp -d)
  for plain in postgres.dump storage.tar.gz env-config.tar.gz; do
    printf '%s' "${BACKUP_ENCRYPTION_PASSPHRASE}" | gpg --batch --quiet --yes \
      --symmetric --cipher-algo AES256 \
      --passphrase-fd 0 --pinentry-mode loopback \
      --output "${_UPLOAD_TMP}/${plain}.gpg" "${SNAPSHOT_DIR}/${plain}"

    # Ensayo de descifrado ANTES de subir: un .gpg que esta misma passphrase no
    # abre es un respaldo perdido que nadie nota hasta el día del desastre.
    if ! printf '%s' "${BACKUP_ENCRYPTION_PASSPHRASE}" | gpg --batch --quiet --yes \
        --decrypt --passphrase-fd 0 --pinentry-mode loopback \
        --output /dev/null "${_UPLOAD_TMP}/${plain}.gpg"; then
      error "El cifrado de ${plain} no se pudo verificar: gpg no puede volver a abrirlo."
      error "  NO se sube un snapshot ilegible. Revisa la instalación de gpg y reintenta."
      exit 1
    fi
  done
  cp "$MANIFEST" "${_UPLOAD_TMP}/manifest.json"
  UPLOAD_SRC="${_UPLOAD_TMP}"
  SNAPSHOT_ENCRYPTED="true"
  log "  Snapshot cifrado (AES256, gpg simétrico). Descifrar: gpg --decrypt archivo.gpg"
  log "  Los SHA256 del manifiesto son los del archivo EN CLARO: verificar después de descifrar."
else
  warn "  BACKUP_ENCRYPTION_PASSPHRASE no definida: el snapshot sube SIN CIFRAR."
  warn "  Incluye la llave DTE_SETTINGS_KEYRING junto al dump que esa llave abre."
fi

# ── Cloudreve (WebDAV): destino remoto activo ────────────────────────────────
if [ "${CLOUDREVE_BACKUP_ENABLED:-false}" = "true" ]; then
  _FAILED_STEP="upload_cloudreve"
  log "  Subiendo a Cloudreve (${CLOUDREVE_BACKUP_PATH:-backups/plataforma})..."
  node /app/scripts/upload-backup-cloudreve.cjs \
    "${UPLOAD_SRC}" "${DATE_STR}" "${CLOUDREVE_BACKUP_PATH:-backups/plataforma}" \
    2>&1 | while IFS= read -r line; do log "  cloudreve: ${line}"; done
  # El script sale != 0 si faltan credenciales o si algún artefacto no subió;
  # con `set -euo pipefail` el backup entero aborta (no queda "copia remota"
  # que en realidad no existe).
  CLOUDREVE_UPLOADED="true"
else
  log "  Cloudreve desactivado (CLOUDREVE_BACKUP_ENABLED != true)."
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
log "  Cloudreve: ${CLOUDREVE_UPLOADED}"
log ""

# Clear failed step on success
_FAILED_STEP=""

# Escribir estado para monitoreo
{
  echo "BACKUP_STATUS=OK"
  echo "BACKUP_RUN_ID=${BACKUP_RUN_ID:-}"
  echo "BACKUP_DATE=${DATE_STR}"
  echo "BACKUP_MANIFEST_SHA256=${MANIFEST_SHA256}"
  echo "BACKUP_TOTAL_SIZE=${TOTAL_SIZE}"
  echo "BACKUP_CLOUDREVE_UPLOADED=${CLOUDREVE_UPLOADED}"
} > "${BACKUP_DIR}/.backup-status"

exit 0
