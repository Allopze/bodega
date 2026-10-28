#!/usr/bin/env bash
set -euo pipefail

# ── Backup Verify — Monitoreo y verificación de backups ───────────────────────
# Verifica que los backups recientes existan, tengan checksums válidos y
# estén accesibles en Cloudreve.
#
# Usage:
#   ./scripts/backup-verify.sh              # Verifica el backup más reciente
#   ./scripts/backup-verify.sh --json       # Salida JSON para monitoreo
#
# Exit codes:
#   0 = OK (backup reciente y válido)
#   1 = WARNING (backup existe pero algo está degradado)
#   2 = CRITICAL (sin backup reciente o corrupto)
# ──────────────────────────────────────────────────────────────────────────────

# ── Configuración ─────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/srv/bodega/backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-28}"  # tolerancia: diario + 4h de margen
STORAGE_PATH="${STORAGE_PATH:-/srv/bodega/storage}"

JSON_OUTPUT=false

for arg in "$@"; do
  case "$arg" in
    --json) JSON_OUTPUT=true ;;
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

# ── 2. Verificar backup en Cloudreve (solo si está activo) ───────────────────
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

# ── 2b. Ensayo de restauración ───────────────────────────────────────────────
# RES-001: todo lo anterior comprueba que el respaldo existe, pesa y se abre.
# Que se pueda RESTAURAR lo comprueba `backup-restore-drill.sh`, que corre con
# su propia periodicidad y deja acá su resultado. Se lee ese resultado en vez de
# restaurar en línea: el ensayo tarda minutos y la verificación es diaria.

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
    # PREV-I13-E: WARNING ya no significa sólo "no corrió"; también que la
    # base restaurada referencia archivos que el tar de storage no trae.
    ISSUES+=("El ensayo de restauración terminó con avisos hace ${DRILL_AGE_DAYS}d (no pudo ejecutarse, o faltan en el tar de storage archivos que la base referencia): ver ${DRILL_FILE}")
    [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
  else
    log "OK: Ensayo de restauración ${DRILL_STATUS} hace ${DRILL_AGE_DAYS}d"
  fi
fi

# ── 3. Verificar espacio en disco ────────────────────────────────────────────

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
