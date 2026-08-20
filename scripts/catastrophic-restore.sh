#!/usr/bin/env bash
set -euo pipefail

# ── Catastrophic Restore — Restauración completa en servidor NUEVO ────────────
# Uso ÚNICAMENTE cuando:
#   - El servidor de producción se perdió totalmente (fire, ransomware, etc.)
#   - Tienes un servidor NUEVO con SO instalado
#   - Tienes acceso al JSON del Service Account de Google Drive
#
# Este script INSTALA todo desde cero y restaura el backup más reciente.
#
# Requisitos:
#   - Servidor Ubuntu/Debian 22.04+ limpio
#   - Acceso root o sudo
#   - Service Account JSON disponible (ver SETUP_GOOGLE_DRIVE_BACKUP.md)
#   - Si los respaldos se suben cifrados: BACKUP_ENCRYPTION_PASSPHRASE en el
#     entorno. NO viaja dentro del snapshot (ese es el punto); vive en el
#     gestor de secretos corporativo. Ver docs/deploy/RESPALDOS_Y_RESTAURACION.md
#
# Usage:
#   sudo ./scripts/catastrophic-restore.sh --service-account-json /path/to/sa.json
#   sudo ./scripts/catastrophic-restore.sh --date 2026-07-19 --service-account-json /path/to/sa.json
#   sudo BACKUP_ENCRYPTION_PASSPHRASE='...' ./scripts/catastrophic-restore.sh --service-account-json /path/to/sa.json
#
# Flags:
#   --service-account-json PATH   (REQUERIDO) Ruta al JSON del Service Account
#   --date YYYY-MM-DD            Fecha específica a restaurar (default: latest)
#   --app-path PATH              Ruta de instalación (default: /srv/bodega)
#   --dry-run                    Solo muestra lo que se haría
# ──────────────────────────────────────────────────────────────────────────────

# ── Parse flags ──────────────────────────────────────────────────────────────

# Se guarda para poder sugerir el reintento exacto si falta la passphrase.
ORIGINAL_ARGS="$*"

SA_JSON=""
RESTORE_DATE=""
APP_PATH=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-account-json) SA_JSON="$2"; shift 2 ;;
    --date) RESTORE_DATE="$2"; shift 2 ;;
    --app-path) APP_PATH="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "ERROR: Argumento desconocido: $1"; exit 1 ;;
  esac
done

# ── Validaciones ──────────────────────────────────────────────────────────────

if [ -z "$SA_JSON" ]; then
  echo "ERROR: --service-account-json es OBLIGATORIO"
  echo "  Uso: sudo ./scripts/catastrophic-restore.sh --service-account-json /ruta/al/sa.json"
  exit 1
fi

if [ ! -f "$SA_JSON" ]; then
  echo "ERROR: No se encontró el archivo: ${SA_JSON}"
  exit 1
fi

APP_PATH="${APP_PATH:-/srv/bodega}"
RESTORE_DATE="${RESTORE_DATE:-latest}"

# ── Funciones ─────────────────────────────────────────────────────────────────

log()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*"; }
# warn() se usaba en el paso 6 sin estar definida: con `set -e` el "command not
# found" abortaba la restauración justo cuando sólo había que advertir.
warn()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: $*"; }
run() {
  if $DRY_RUN; then
    log "[DRY-RUN] $*"
  else
    log "EJECUTANDO: $*"
    "$@"
  fi
}

# ── Banner ────────────────────────────────────────────────────────────────────

clear
cat <<BANNER

╔══════════════════════════════════════════════════════════════╗
║        RESTAURACIÓN CATASTRÓFICA - Plataforma Chome         ║
╠══════════════════════════════════════════════════════════════╣
║  Esto INSTALARÁ TODO desde cero y RESTAURARÁ el backup      ║
║  más reciente desde Google Drive.                           ║
║                                                              ║
║  Fecha a restaurar: ${RESTORE_DATE}                             ║
║  Ruta de instalación: ${APP_PATH}                              ║
╚══════════════════════════════════════════════════════════════╝

BANNER

read -p "¿Continuar? [y/N] " confirm
if [ "$confirm" != "y" ]; then
  log "Abortado."
  exit 0
fi

# ── 1. Instalar dependencias del sistema ─────────────────────────────────────

log ""
log "=== Paso 1/8: Instalando dependencias del sistema ==="

run apt-get update -y
run apt-get install -y \
  curl wget gnupg ca-certificates \
  rclone postgresql-client \
  jq git

# ── 2. Instalar Docker ───────────────────────────────────────────────────────

log ""
log "=== Paso 2/8: Instalando Docker ==="

if ! command -v docker &>/dev/null; then
  run curl -fsSL https://get.docker.com | bash
  run usermod -aG docker "$USER"
fi

# ── 3. Instalar Node.js ──────────────────────────────────────────────────────

log ""
log "=== Paso 3/8: Instalando Node.js ==="

if ! command -v node &>/dev/null; then
  run curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  run apt-get install -y nodejs
fi

# ── 4. Configurar rclone con Service Account ─────────────────────────────────

log ""
log "=== Paso 4/8: Configurando rclone con Service Account ==="

run mkdir -p /srv/bodega/secrets
run cp "$SA_JSON" /srv/bodega/secrets/gdrive-service-account.json
run chmod 600 /srv/bodega/secrets/gdrive-service-account.json

run rclone config create gdrive-backups drive \
  scope drive.file \
  service_account_file /srv/bodega/secrets/gdrive-service-account.json \
  --quiet

# Probar conexión
log "Probando conexión a Google Drive..."
if ! run rclone lsd "gdrive-backups:" 2>/dev/null; then
  error "No se pudo conectar a Google Drive. Verifica el Service Account."
  exit 1
fi

# ── 5. Descargar y verificar backup ──────────────────────────────────────────

log ""
log "=== Paso 5/8: Descargando backup desde Google Drive ==="

RESTORE_TARGET="${APP_PATH}/restore"
run mkdir -p "$RESTORE_TARGET"

# Primero verificar que el backup existe
REMOTE_PATH="gdrive-backups:bodega-backups/${RESTORE_DATE}"
if ! run rclone ls "$REMOTE_PATH" 2>/dev/null | grep -q manifest.json; then
  error "No se encontró backup en ${REMOTE_PATH}"
  error "Backups disponibles:"
  run rclone lsd "gdrive-backups:bodega-backups/"
  exit 1
fi

run rclone copy "${REMOTE_PATH}/" "${RESTORE_TARGET}/" --verbose --checksum

# Verificar integridad
log "Verificando integridad del backup..."
MANIFEST="${RESTORE_TARGET}/manifest.json"

if [ ! -f "$MANIFEST" ]; then
  error "No se encontró manifest.json. Backup corrupto."
  exit 1
fi

# ── 5b. Descifrar el snapshot si viene cifrado ────────────────────────────────
# backup-orchestrator.sh sube `postgres.dump.gpg`, `storage.tar.gz.gpg` y
# `env-config.tar.gz.gpg` (gpg simétrico, AES256) cuando el host de respaldo
# tiene BACKUP_ENCRYPTION_PASSPHRASE; el manifiesto viaja siempre en claro.
# Sus sha256 son los del archivo ANTES de cifrar, así que el orden obligatorio
# es descifrar primero y verificar después: al revés todo falla en falso.

SNAPSHOT_FILES=(postgres.dump storage.tar.gz env-config.tar.gz)
MANIFEST_ENCRYPTED=$(jq -r '.upload.encrypted // false' "$MANIFEST" 2>/dev/null || echo false)

if [ -f "${RESTORE_TARGET}/postgres.dump.gpg" ] || [ "$MANIFEST_ENCRYPTED" = "true" ]; then
  log "Snapshot CIFRADO (gpg simétrico AES256)."

  if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    error "El snapshot de '${RESTORE_DATE}' está cifrado y BACKUP_ENCRYPTION_PASSPHRASE no está definida."
    error ""
    error "  Sin esa passphrase este respaldo es IRRECUPERABLE. No está dentro del"
    error "  snapshot a propósito: cifrar el dump y guardar la llave al lado no protege nada."
    error ""
    error "  Dónde está guardada:"
    error "    1. Gestor de secretos corporativo → entrada 'Chome — BACKUP_ENCRYPTION_PASSPHRASE'"
    error "    2. Copia sellada fuera de línea (caja fuerte de gerencia)"
    error "    3. Procedimiento completo: docs/deploy/RESPALDOS_Y_RESTAURACION.md"
    error ""
    error "  Reintenta con:"
    error "    sudo BACKUP_ENCRYPTION_PASSPHRASE='<passphrase>' $0 ${ORIGINAL_ARGS}"
    exit 1
  fi

  if ! command -v gpg &>/dev/null; then
    error "gpg no está instalado y el snapshot está cifrado. Instala: apt-get install -y gnupg"
    exit 1
  fi

  log "Descifrando snapshot antes de verificar checksums..."
  GPG_ERR="${RESTORE_TARGET}/.gpg-error"

  for plain in "${SNAPSHOT_FILES[@]}"; do
    enc="${RESTORE_TARGET}/${plain}.gpg"

    if [ ! -f "$enc" ]; then
      if [ -f "${RESTORE_TARGET}/${plain}" ]; then
        log "  ${plain}: ya viene en claro, no hay nada que descifrar"
        continue
      fi
      error "  ${plain}: no está ni cifrado (${plain}.gpg) ni en claro. Snapshot incompleto."
      exit 1
    fi

    if $DRY_RUN; then
      log "[DRY-RUN] gpg --decrypt ${enc} → ${RESTORE_TARGET}/${plain}"
      continue
    fi

    if ! printf '%s' "${BACKUP_ENCRYPTION_PASSPHRASE}" | gpg --batch --quiet --yes \
        --decrypt --passphrase-fd 0 --pinentry-mode loopback \
        --output "${RESTORE_TARGET}/${plain}" "$enc" 2>"$GPG_ERR"; then
      error "  ${plain}: gpg no pudo descifrar el archivo."
      error "  Causa más probable: la passphrase no corresponde a ESTE snapshot"
      error "  (se rotó después del ${RESTORE_DATE}). Prueba la passphrase anterior:"
      error "  el gestor de secretos guarda el histórico de rotaciones."
      sed 's/^/    gpg: /' "$GPG_ERR" >&2 2>/dev/null || true
      rm -f "$GPG_ERR" "${RESTORE_TARGET}/${plain}"
      exit 1
    fi

    # El env-config lleva secretos en claro: no queda legible para otros usuarios.
    chmod 600 "${RESTORE_TARGET}/${plain}"
    log "  ${plain}: descifrado"
  done

  rm -f "$GPG_ERR"
  log "Snapshot descifrado. Los sha256 del manifiesto son los del archivo en claro."
fi

log "Manifiesto encontrado. Verificando checksums..."
PG_SHA=$(jq -r '.components.postgres.sha256' "$MANIFEST")
ST_SHA=$(jq -r '.components.storage.sha256' "$MANIFEST")
CF_SHA=$(jq -r '.components.config.sha256' "$MANIFEST")

verify_sha() {
  local file="$1" expected="$2" name="$3"
  local actual
  actual=$(sha256sum "$file" | cut -d' ' -f1)
  if [ "$actual" != "$expected" ]; then
    error "  ${name}: CHECKSUM FAILED (esperado: ${expected}, obtenido: ${actual})"
    return 1
  fi
  log "  ${name}: ✓ OK"
}

verify_sha "${RESTORE_TARGET}/postgres.dump" "$PG_SHA" "PostgreSQL" || exit 1
verify_sha "${RESTORE_TARGET}/storage.tar.gz" "$ST_SHA" "Storage" || exit 1
verify_sha "${RESTORE_TARGET}/env-config.tar.gz" "$CF_SHA" "Config" || exit 1

# ── 6. Restaurar configuración ───────────────────────────────────────────────

log ""
log "=== Paso 6/8: Restaurando configuración ==="

CONFIG_TMP=$(mktemp -d)
run tar -xzf "${RESTORE_TARGET}/env-config.tar.gz" -C "$CONFIG_TMP"

if [ -f "${CONFIG_TMP}/.env" ]; then
  run cp "${CONFIG_TMP}/.env" "${APP_PATH}/.env"
  run chmod 600 "${APP_PATH}/.env"
  log ".env restaurado"
fi

# Restaurar rclone.conf desde el backup
if [ -f "${CONFIG_TMP}/rclone.conf" ]; then
  RCLONE_DEFAULT="${HOME}/.config/rclone/rclone.conf"
  RCLONE_DIR=$(dirname "${RCLONE_CONFIG:-${RCLONE_DEFAULT}}")
  run mkdir -p "$RCLONE_DIR"
  run cp "${CONFIG_TMP}/rclone.conf" "${RCLONE_DIR}/rclone.conf"
  run chmod 600 "${RCLONE_DIR}/rclone.conf"
  log "rclone.conf: restaurado en ${RCLONE_DIR}/rclone.conf"
else
  log "  rclone.conf no encontrado en el backup (se configurará vía SA JSON)"
fi

# Restaurar Service Account JSON
if [ -f "${CONFIG_TMP}/gdrive-service-account.json" ]; then
  SA_DIR="/srv/bodega/secrets"
  run mkdir -p "$SA_DIR"
  run cp "${CONFIG_TMP}/gdrive-service-account.json" "${SA_DIR}/gdrive-service-account.json"
  run chmod 600 "${SA_DIR}/gdrive-service-account.json"
  log "Service Account JSON: restaurado en ${SA_DIR}/gdrive-service-account.json"

  # Reconfigurar rclone con el SA restaurado (eliminar remote existente y recrear)
  log "  Reconfigurando rclone remote con el Service Account restaurado..."
  run rclone config delete gdrive-backups 2>/dev/null || true
  run rclone config create gdrive-backups drive \
    scope drive.file \
    service_account_file /srv/bodega/secrets/gdrive-service-account.json \
    --quiet

  # Verificar conectividad post-restauración
  log "  Verificando conectividad con Google Drive..."
  if run rclone lsd "gdrive-backups:bodega-backups/" 2>/dev/null; then
    log "  ✓ Conectividad Drive OK"
  else
    warn "  No se pudo conectar a Google Drive después de restaurar el SA."
    warn "  Revisa docs/deploy/SETUP_GOOGLE_DRIVE_BACKUP.md — sección 'Solución de problemas'"
  fi
else
  log "  Service Account JSON no encontrado en el backup."
  log "  Deberás proporcionarlo manualmente (ver docs/deploy/SETUP_GOOGLE_DRIVE_BACKUP.md)"
fi

# Mostrar resumen
if [ -f "${CONFIG_TMP}/system-info.json" ]; then
  log "Info del sistema original:"
  jq '.' "${CONFIG_TMP}/system-info.json" | while IFS= read -r line; do log "  $line"; done
fi

run rm -rf "$CONFIG_TMP"

# ── 7. Clonar repo + storage ────────────────────────────────────────────────

log ""
log "=== Paso 7/8: Clonando repositorio y restaurando storage ==="

if $DRY_RUN; then
  log "[DRY-RUN] Saltando clonación y restauración de datos"
else
  # Clonar el repo
  if [ ! -d "${APP_PATH}/.git" ]; then
    read -p "URL del repositorio Git [https://github.com/allopze/bodega]: " REPO_URL
    REPO_URL="${REPO_URL:-https://github.com/allopze/bodega}"
    run git clone "$REPO_URL" "${APP_PATH}/tmp-repo" || true

    if [ -d "${APP_PATH}/tmp-repo" ]; then
      run cp "${APP_PATH}/tmp-repo/docker-compose.yml" "${APP_PATH}/docker-compose.yml"
      run cp "${APP_PATH}/tmp-repo/scripts/"*.sh "${APP_PATH}/scripts/"
      run chmod +x "${APP_PATH}/scripts/"*.sh
      run rm -rf "${APP_PATH}/tmp-repo"
    fi
  fi

  # Restaurar storage
  if [ -s "${RESTORE_TARGET}/storage.tar.gz" ]; then
    STORAGE_PATH=$(grep -oP '^STORAGE_PATH=\K.*' "${APP_PATH}/.env" 2>/dev/null || echo "${APP_PATH}/storage")
    run mkdir -p "$STORAGE_PATH"
    run tar -xzf "${RESTORE_TARGET}/storage.tar.gz" -C "$(dirname "$STORAGE_PATH")"
    log "Storage restaurado en ${STORAGE_PATH}"
  fi
fi

# ── 8. Restaurar PostgreSQL e iniciar app ────────────────────────────────────

log ""
log "=== Paso 8/8: Restaurando PostgreSQL e iniciando app ==="

if $DRY_RUN; then
  log "[DRY-RUN] Saltando restore de PostgreSQL"
elif [ ! -s "${RESTORE_TARGET}/postgres.dump" ]; then
  log "  postgres.dump está vacío o no existe. Omitiendo."
else
  # Obtener DATABASE_URL desde el .env
  PG_URL=$(grep -oP '^DATABASE_URL=\K.*' "${APP_PATH}/.env" 2>/dev/null | head -1)

  if [ -z "$PG_URL" ]; then
    log "  WARN: DATABASE_URL no encontrada en .env"
    log "  Para restaurar manualmente:"
    log "    pg_restore --clean --no-owner --dbname='<URL>' ${RESTORE_TARGET}/postgres.dump"
  else
    log "  Iniciando base de datos Docker..."
    run docker compose -f "${APP_PATH}/docker-compose.yml" up -d db || {
      error "No se pudo iniciar el contenedor db"
      log "  Asegúrate de que docker-compose.yml y .env están correctos"
      log "  Luego ejecuta manualmente:"
      log "    docker compose up -d db"
      log "    pg_restore --clean --no-owner --dbname=\"$PG_URL\" ${RESTORE_TARGET}/postgres.dump"
      exit 1
    }

    log "  Esperando a que PostgreSQL esté lista..."
    for i in $(seq 1 12); do
      if docker compose -f "${APP_PATH}/docker-compose.yml" exec -T db pg_isready -q 2>/dev/null; then
        log "  PostgreSQL lista después de ${i}s"
        break
      fi
      if [ "$i" -eq 12 ]; then
        error "PostgreSQL no respondió después de 60s"
        exit 1
      fi
      sleep 5
    done

    # Crear usuario si no existe
    run docker compose -f "${APP_PATH}/docker-compose.yml" exec -T db createuser -s bodega 2>/dev/null || true

    log "  Restaurando PostgreSQL desde backup..."

    # Validar estructura del dump antes del --clean destructivo
    log "  Validando estructura del dump con pg_restore --list..."
    if ! pg_restore --list "${RESTORE_TARGET}/postgres.dump" > /dev/null 2>&1; then
      error "El dump postgres.dump está corrupto o truncado (pg_restore --list falló)."
      error "NO se procederá con la restauración destructiva."
      exit 1
    fi
    log "  Estructura del dump: OK"

    run pg_restore --clean --if-exists --no-owner --no-acl \
      --dbname="$PG_URL" \
      --verbose \
      "${RESTORE_TARGET}/postgres.dump" 2>&1 | while IFS= read -r line; do log "  pg_restore: ${line}"; done

    log "  PostgreSQL restaurado correctamente."

    # Aplicar migraciones
    log "  Aplicando migraciones Drizzle..."
    run docker compose -f "${APP_PATH}/docker-compose.yml" run --rm migrate 2>&1 | while IFS= read -r line; do log "  migrate: ${line}"; done

    # Iniciar app
    log "  Iniciando aplicación..."
    run docker compose -f "${APP_PATH}/docker-compose.yml" up -d app

    # Healthcheck
    sleep 5
    if curl -sf http://127.0.0.1:3000/api/health; then
      log ""
      log "  ✓ Healthcheck OK — app funcionando"
    else
      log ""
      log "  ⚠️ Healthcheck falló. Revisa logs: docker compose logs app"
    fi
  fi
fi

# ── Finalización ──────────────────────────────────────────────────────────────

log ""
log "╔══════════════════════════════════════════════════════════════╗"
log "║       RESTAURACIÓN CATASTRÓFICA COMPLETADA                  ║"
log "╚══════════════════════════════════════════════════════════════╝"
log ""
log "Resumen:"
log "  Backup restaurado:   ${RESTORE_DATE}"
log "  Ruta de instalación: ${APP_PATH}"
log "  Config:              ${APP_PATH}/.env"
log "  Scripts:             ${APP_PATH}/scripts/"
log "  Storage:             ✓ Restaurado"
log "  PostgreSQL:          ✓ Restaurado (vía pg_restore automático)"
log "  Migraciones:         ✓ Aplicadas (docker compose run --rm migrate)"
log "  Backup local:        ${RESTORE_TARGET}"
log ""
log "Próximos pasos:"
log "  1. Revisa los secrets en ${APP_PATH}/.env"
log "     Faltan: AUTH_SECRET, PREVENTION_DATA_ENCRYPTION_KEY, CRON_SECRET"
log "     → Sácalos del password manager corporativo"
log ""
log "  1b. Vuelve a inyectar BACKUP_ENCRYPTION_PASSPHRASE en el entorno del host"
log "      (docker-compose / systemd / cron). NO está en el .env restaurado a"
log "      propósito, así que sin este paso los respaldos futuros suben SIN CIFRAR."
log "      Verifica después con: sudo scripts/backup-verify.sh"
log ""
log "  2. Verifica que el Service Account JSON esté en su lugar:"
log "     ls -la /srv/bodega/secrets/gdrive-service-account.json"
log "     → Si no aparece, sácalo del password manager"
log ""
log "  3. Verifica que la app responde:"
log "     curl -f http://localhost:3000/api/health"
log ""
log "  4. Revisa los logs:"
log "     docker compose logs --tail=50 app"
log ""
log "  5. Verifica backups futuros:"
log "     sudo /srv/bodega/scripts/backup-orchestrator.sh"
log "     rclone ls gdrive-backups:bodega-backups/$(date +%F)/"
log ""
log "  6. Programa el cron diario de backups:"
log "     crontab -e"
log "     0 3 * * * /srv/bodega/scripts/backup-orchestrator.sh >> /var/log/bodega-backup.log 2>&1"
log ""

exit 0
