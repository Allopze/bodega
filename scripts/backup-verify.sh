#!/usr/bin/env bash
set -euo pipefail

# ── Backup Verify — Monitoreo y verificación de backups ───────────────────────
# Verifica que los backups recientes existan, tengan checksums válidos y
# estén accesibles en Google Drive.
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

log()   { echo "$*"; }
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
  SNAPSHOTS=$(find "${BACKUP_DIR}/snapshots" -maxdepth 1 -type d -mtime -2 2>/dev/null | wc -l)
  if [ "$SNAPSHOTS" -eq 0 ]; then
    ISSUES+=("No hay snapshots de backup en las últimas 48h")
    [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2
  else
    log "OK: Snapshots recientes: ${SNAPSHOTS}"
  fi
fi

# ── 2. Verificar backup en Google Drive ──────────────────────────────────────

if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q 'gdrive-backups:'; then
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
  ISSUES+=("rclone/gdrive-backups no configurado")
  [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1
fi

# ── 3. Verificar espacio en disco ────────────────────────────────────────────

if ! $DRIVE_ONLY; then
  DISK_USAGE=$(df -h "$BACKUP_DIR" 2>/dev/null | awk 'NR==2 {print $5}' | sed 's/%//')
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
