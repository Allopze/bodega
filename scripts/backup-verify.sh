#!/usr/bin/env bash
set -euo pipefail

# ── Backup Verify — Monitoreo y verificación de backups ───────────────────────
# Verifica que los backups recientes existan, tengan checksums válidos y
# estén accesibles en Google Drive. Si el snapshot remoto viene cifrado, además
# ensaya el descifrado con BACKUP_ENCRYPTION_PASSPHRASE (ver paso 2b): un
# respaldo que la passphrase no abre se detecta acá, no el día del desastre.
#
# Usage:
#   ./scripts/backup-verify.sh              # Verifica el backup más reciente
#   ./scripts/backup-verify.sh --json       # Salida JSON para monitoreo
#   ./scripts/backup-verify.sh --drive-only  # Solo verifica presencia en Drive
#
# Exit codes:
#   0 = OK (backup reciente y válido)
#   1 = WARNING (backup existe pero algo está degradado)
#   2 = CRITICAL (sin backup reciente o corrupto)
# ──────────────────────────────────────────────────────────────────────────────

# ── Configuración ─────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/srv/bodega/backups}"
GDRIVE_DEST="${GDRIVE_DEST:-gdrive-backups:bodega-backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-28}"  # tolerancia: diario + 4h de margen
STORAGE_PATH="${STORAGE_PATH:-/srv/bodega/storage}"

JSON_OUTPUT=false
DRIVE_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --json) JSON_OUTPUT=true ;;
    --drive-only) DRIVE_ONLY=true ;;
  esac
done

# ── Funciones ─────────────────────────────────────────────────────────────────

# Con --json el informe legible va a stderr: los "OK: ..." salían por stdout
# mezclados con el JSON y `JSON.parse` de app/api/backups/status/route.ts fallaba
# siempre, así que el estado de los respaldos nunca llegaba a la UI.
log()   { if $JSON_OUTPUT; then echo "$*" >&2; else echo "$*"; fi; }
error() { echo "$*" >&2; }

# ── Estado inicial ────────────────────────────────────────────────────────────

EXIT_CODE=0
ISSUES=()

# ── 1. Verificar backup local ────────────────────────────────────────────────

if ! $DRIVE_ONLY; then
  LATEST_PG="${BACKUP_DIR}/pg/bodega-latest.dump"

  if [ -L "$LATEST_PG" ] && [ -f "$LATEST_PG" ]; then
    PG_FILE=$(readlink "$LATEST_PG")
    PG_PATH="${BACKUP_DIR}/pg/${PG_FILE}"
    PG_AGE=$(( ($(date +%s) - $(stat -c%Y "$PG_PATH" 2>/dev/null || stat -f%m "$PG_PATH" 2>/dev/null)) / 3600 ))

    if [ "$PG_AGE" -gt "$MAX_AGE_HOURS" ]; then
      ISSUES+=("PostgreSQL backup tiene ${PG_AGE}h (máx: ${MAX_AGE_HOURS}h)")
      [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2
    else
      PG_SIZE=$(du -h "$PG_PATH" | cut -f1)
      log "OK: PostgreSQL backup (${PG_AGE}h ago, ${PG_SIZE})"
    fi
  else
    ISSUES+=("No se encontró backup local de PostgreSQL en ${LATEST_PG}")
    EXIT_CODE=2
  fi

  # Verificar storage
  if [ -d "$STORAGE_PATH" ]; then
    STORAGE_COUNT=$(find "$STORAGE_PATH" -type f | wc -l)
    log "OK: Storage presente (${STORAGE_COUNT} archivos en ${STORAGE_PATH})"
  else
    ISSUES+=("STORAGE_PATH (${STORAGE_PATH}) no existe")
    [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
  fi

  # Verificar snapshots recientes
  # `|| true`: con `pipefail`, un find que falla (directorio inexistente) hacía
  # fallar la asignación y `set -e` mataba el script sin imprimir ni el informe
  # ni el JSON — el monitoreo veía exit 1 y ningún motivo.
  SNAPSHOTS=$(find "${BACKUP_DIR}/snapshots" -maxdepth 1 -type d -mtime -2 2>/dev/null | wc -l || true)
  if [ "$SNAPSHOTS" -eq 0 ]; then
    ISSUES+=("No hay snapshots de backup en las últimas 48h")
    [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2
  else
    log "OK: Snapshots recientes: ${SNAPSHOTS}"
  fi
fi

# ── 2. Verificar backup en Google Drive (solo si está activo) ────────────────

if [ "${DRIVE_BACKUP_ENABLED:-false}" = "true" ] \
  && command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q 'gdrive-backups:'; then
  # Listar backups en Drive de los últimos días
  DRIVE_BACKUPS=$(rclone lsd "${GDRIVE_DEST}/" 2>/dev/null | grep -v latest | wc -l)

  if [ "$DRIVE_BACKUPS" -eq 0 ]; then
    ISSUES+=("No hay backups en Google Drive")
    [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2
  else
    # Buscar backup de hoy
    TODAY=$(date '+%Y-%m-%d')
    if rclone lsd "${GDRIVE_DEST}/" 2>/dev/null | grep -q "$TODAY"; then
      log "OK: Backup de hoy ($TODAY) en Google Drive"
    else
      YESTERDAY=$(date -d '-1 day' '+%Y-%m-%d')
      if rclone lsd "${GDRIVE_DEST}/" 2>/dev/null | grep -q "$YESTERDAY"; then
        log "WARN: Backup de ayer ($YESTERDAY) en Drive (hoy aún no)"
        [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
      else
        ISSUES+=("Backup más reciente en Drive tiene >48h")
        [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2
      fi
    fi

    # Verificar que latest existe y tiene manifest
    if rclone ls "${GDRIVE_DEST}/latest/manifest.json" &>/dev/null; then
      log "OK: Symlink 'latest' presente en Drive"
    else
      ISSUES+=("Symlink 'latest' faltante en Google Drive")
      [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
    fi
  fi
else
  if [ "${DRIVE_BACKUP_ENABLED:-false}" = "true" ]; then
    ISSUES+=("rclone/gdrive-backups no configurado")
    [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
  fi
fi

# ── 2b. Ensayo de descifrado del snapshot remoto ─────────────────────────────
# Un respaldo cifrado que la passphrase no abre es peor que no tener respaldo:
# el monitoreo queda verde durante meses y el error se descubre el día del
# desastre. Se baja el artefacto más chico del snapshot (env-config, unos KB) y
# se descifra hacia /dev/null: prueba real de que ESTA passphrase abre ESTE
# snapshot, sin dejar los secretos en disco.

if [ "${DRIVE_BACKUP_ENABLED:-false}" = "true" ] \
  && command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q 'gdrive-backups:'; then
  NEWEST_REMOTE=$(rclone lsd "${GDRIVE_DEST}/" 2>/dev/null | awk '{print $NF}' \
    | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort | tail -1 || true)

  if [ -n "$NEWEST_REMOTE" ] && rclone ls "${GDRIVE_DEST}/${NEWEST_REMOTE}/env-config.tar.gz.gpg" &>/dev/null; then
    if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
      ISSUES+=("Snapshot ${NEWEST_REMOTE} está cifrado pero BACKUP_ENCRYPTION_PASSPHRASE no está en este host: no se puede comprobar que sea recuperable")
      [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
    elif ! command -v gpg &>/dev/null; then
      ISSUES+=("Snapshot ${NEWEST_REMOTE} está cifrado y gpg no está instalado: no se puede comprobar que sea recuperable")
      [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
    else
      PROBE_DIR=$(mktemp -d)
      trap 'rm -rf "$PROBE_DIR"' EXIT
      if rclone copy "${GDRIVE_DEST}/${NEWEST_REMOTE}/env-config.tar.gz.gpg" "${PROBE_DIR}/" --quiet 2>/dev/null \
        && printf '%s' "${BACKUP_ENCRYPTION_PASSPHRASE}" | gpg --batch --quiet --decrypt \
             --passphrase-fd 0 --pinentry-mode loopback \
             "${PROBE_DIR}/env-config.tar.gz.gpg" >/dev/null 2>&1; then
        log "OK: Ensayo de descifrado del snapshot ${NEWEST_REMOTE} (la passphrase lo abre)"
      else
        ISSUES+=("La passphrase de este host NO abre el snapshot cifrado ${NEWEST_REMOTE}: ese respaldo es irrecuperable")
        [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2
      fi
      rm -rf "$PROBE_DIR"
      trap - EXIT
    fi
  fi
fi

# ── 2c. Verificar backup en Cloudreve (solo si está activo) ──────────────────
if [ "${CLOUDREVE_BACKUP_ENABLED:-false}" = "true" ]; then
  CLOUDREVE_SCRIPT="${CLOUDREVE_DOWNLOAD_SCRIPT:-/app/scripts/download-backup-cloudreve.cjs}"
  if [ -f "$CLOUDREVE_SCRIPT" ] && command -v node &>/dev/null; then
    TODAY=$(date '+%Y-%m-%d')
    DATES=$(node "$CLOUDREVE_SCRIPT" --list-dates "${CLOUDREVE_BACKUP_PATH:-backups/plataforma}" 2>/dev/null || true)
    if echo "$DATES" | grep -q "$TODAY"; then
      log "OK: Backup de hoy ($TODAY) en Cloudreve"
    else
      YESTERDAY=$(date -d '-1 day' '+%Y-%m-%d')
      if echo "$DATES" | grep -q "$YESTERDAY"; then
        log "WARN: Backup de ayer ($YESTERDAY) en Cloudreve (hoy aún no)"
        [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
      else
        ISSUES+=("Backup más reciente en Cloudreve tiene >48h")
        [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2
      fi
    fi
  else
    ISSUES+=("Cloudreve activado pero script de verificación no disponible (${CLOUDREVE_SCRIPT})")
    [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
  fi
fi

# ── 2d. Ensayo de restauración ───────────────────────────────────────────────
# RES-001: todo lo anterior comprueba que el respaldo existe, pesa y se abre.
# Que se pueda RESTAURAR lo comprueba `backup-restore-drill.sh`, que corre con
# su propia periodicidad y deja acá su resultado. Se lee ese resultado en vez de
# restaurar en línea: el ensayo tarda minutos y la verificación es diaria.

if ! $DRIVE_ONLY; then
  DRILL_FILE="${RESTORE_DRILL_RESULT_FILE:-${BACKUP_DIR}/restore-drill.json}"
  DRILL_MAX_AGE_DAYS="${DRILL_MAX_AGE_DAYS:-8}"   # semanal + 1 día de margen

  if [ ! -f "$DRILL_FILE" ]; then
    ISSUES+=("Nunca se ha ensayado la restauración del respaldo (falta ${DRILL_FILE})")
    [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
  else
    DRILL_AGE_DAYS=$(( ($(date +%s) - $(stat -c%Y "$DRILL_FILE" 2>/dev/null || stat -f%m "$DRILL_FILE" 2>/dev/null)) / 86400 ))
    DRILL_STATUS=$(grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' "$DRILL_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')

    if [ "$DRILL_AGE_DAYS" -gt "$DRILL_MAX_AGE_DAYS" ]; then
      ISSUES+=("El último ensayo de restauración tiene ${DRILL_AGE_DAYS} días (máx: ${DRILL_MAX_AGE_DAYS}): nadie ha comprobado que el respaldo se restaure")
      [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
    elif [ "$DRILL_STATUS" = "CRITICAL" ]; then
      ISSUES+=("El ensayo de restauración FALLÓ hace ${DRILL_AGE_DAYS}d: el respaldo no es restaurable")
      EXIT_CODE=2
    elif [ "$DRILL_STATUS" = "WARNING" ]; then
      ISSUES+=("El ensayo de restauración no pudo ejecutarse (hace ${DRILL_AGE_DAYS}d)")
      [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
    else
      log "OK: Ensayo de restauración ${DRILL_STATUS} hace ${DRILL_AGE_DAYS}d"
    fi
  fi
fi

# ── 3. Verificar espacio en disco ────────────────────────────────────────────

if ! $DRIVE_ONLY; then
  DISK_USAGE=$(df -h "$BACKUP_DIR" 2>/dev/null | awk 'NR==2 {print $5}' | sed 's/%//' || true)
  if [ -n "$DISK_USAGE" ] && [ "$DISK_USAGE" -gt 90 ]; then
    ISSUES+=("Disco al ${DISK_USAGE}% de capacidad (${BACKUP_DIR})")
    [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
  elif [ -n "$DISK_USAGE" ] && [ "$DISK_USAGE" -gt 80 ]; then
    log "WARN: Disco al ${DISK_USAGE}% — monitorear"
    [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
  else
    log "OK: Disco al ${DISK_USAGE:-?}%"
  fi
fi

# ── Salida ────────────────────────────────────────────────────────────────────

if $JSON_OUTPUT; then
  STATUS="OK"
  [ "$EXIT_CODE" -eq 1 ] && STATUS="WARNING"
  [ "$EXIT_CODE" -eq 2 ] && STATUS="CRITICAL"

  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg status "$STATUS" \
      --argjson exit_code "$EXIT_CODE" \
      --argjson issue_count "${#ISSUES[@]}" \
      --arg issues "$(IFS=';'; echo "${ISSUES[*]}")" \
      '{
        status: $status,
        exit_code: $exit_code,
        issue_count: $issue_count,
        issues: ($issues | split(";") | map(select(length > 0))),
        checked_at: (now | strftime("%Y-%m-%dT%H:%M:%SZ"))
      }'
  elif command -v node >/dev/null 2>&1; then
    # La imagen de la aplicación siempre trae Node, pero algunos hosts que
    # ejecutan este script directamente no traen jq. Mantener JSON válido acá
    # evita que el endpoint de estado convierta una alerta real en una respuesta
    # vacía por un binario auxiliar ausente.
    BACKUP_VERIFY_STATUS="$STATUS" \
      BACKUP_VERIFY_EXIT_CODE="$EXIT_CODE" \
      BACKUP_VERIFY_ISSUE_COUNT="${#ISSUES[@]}" \
      BACKUP_VERIFY_ISSUES="$(printf '%s\n' "${ISSUES[@]}")" \
      node --input-type=module <<'NODE'
const issues = (process.env.BACKUP_VERIFY_ISSUES ?? "").split("\n").filter(Boolean)
const payload = {
  status: process.env.BACKUP_VERIFY_STATUS,
  exit_code: Number(process.env.BACKUP_VERIFY_EXIT_CODE),
  issue_count: Number(process.env.BACKUP_VERIFY_ISSUE_COUNT),
  issues,
  checked_at: new Date().toISOString(),
}
process.stdout.write(`${JSON.stringify(payload)}\n`)
NODE
  else
    error "No se puede emitir JSON: se requiere jq o node"
    exit "$EXIT_CODE"
  fi
else
  log ""
  if [ "$EXIT_CODE" -eq 0 ]; then
    log "=== VERIFICACIÓN: OK ==="
  elif [ "$EXIT_CODE" -eq 1 ]; then
    log "=== VERIFICACIÓN: WARNING ==="
  else
    log "=== VERIFICACIÓN: CRITICAL ==="
  fi

  if [ ${#ISSUES[@]} -gt 0 ]; then
    log "Problemas encontrados:"
    for issue in "${ISSUES[@]}"; do
      log "  - ${issue}"
    done
  fi
fi

exit "$EXIT_CODE"
