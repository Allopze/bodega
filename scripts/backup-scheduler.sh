#!/usr/bin/env bash
set -euo pipefail

# ── Backup Scheduler — daily loop dentro del contenedor ───────────────────────
# Ejecuta el orquestador una vez al día.
#
# Obtiene backupHour, retentionDays y maxAgeHours del endpoint
# /api/backups/config (configurable desde el panel admin). Si el endpoint
# no responde, usa defaults (3 AM, 30 días, 36h).
#
# Uso (desde docker-compose):
#   docker compose --profile backup up -d backup-scheduler
#
# Variables de entorno:
#   APP_URL=http://app:3000   # URL base de la app (para API y healthcheck)
# ──────────────────────────────────────────────────────────────────────────────

ORCHESTRATOR="${ORCHESTRATOR:-/app/scripts/backup-orchestrator.sh}"
DRILL_SCRIPT="${RESTORE_DRILL_SCRIPT:-/app/scripts/backup-restore-drill.sh}"
APP_URL="${APP_URL:-http://app:3000}"
LOG_PREFIX="[backup-scheduler]"

log()  { echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} $*"; }
error() { echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} ERROR: $*" >&2; }

log "Backup scheduler iniciado (APP_URL=${APP_URL})"
log "Orquestador: ${ORCHESTRATOR}"

# ── Esperar a que la app esté viva ────────────────────────────────────────────
log "Esperando a que la app responda en ${APP_URL}/api/health..."
for i in $(seq 1 30); do
  if wget -qO- "${APP_URL}/api/health" &>/dev/null; then
    log "App responde OK después de ${i}s"
    break
  fi
  if [ "$i" -eq 30 ]; then
    error "App no respondió después de 150s. Scheduler se detiene."
    exit 1
  fi
  sleep 5
done

# ── Función para obtener config desde la API ──────────────────────────────────
fetch_config() {
  if [ -n "${CRON_SECRET:-}" ]; then
    wget -qO- --timeout=10 \
      --header="Authorization: Bearer ${CRON_SECRET}" \
      "${APP_URL}/api/backups/config" 2>/dev/null || echo ""
  else
    log "CRON_SECRET no configurado, usando defaults"
    echo ""
  fi
}

# Lee un campo del JSON de config; cae al default si falta o si el JSON está vacío.
cfg() {
  local json="$1" field="$2" default="$3"
  echo "$json" | jq -r --arg f "$field" --arg d "$default" 'if has($f) then (.[$f] // $d) else $d end' 2>/dev/null || echo "$default"
}

while true; do
  # Obtener configuración actualizada cada ciclo
  CONFIG_JSON="$(fetch_config)"

  if [ -n "$CONFIG_JSON" ]; then
    BACKUP_HOUR="$(cfg "$CONFIG_JSON" backupHour 3)"
    RETENTION_DAYS="$(cfg "$CONFIG_JSON" retentionDays 30)"
    MAX_AGE_HOURS="$(cfg "$CONFIG_JSON" maxAgeHours 36)"
    DRIVE_BACKUP_ENABLED="$(cfg "$CONFIG_JSON" driveBackupsEnabled false)"
    CLOUDREVE_BACKUP_ENABLED="$(cfg "$CONFIG_JSON" cloudreveBackupsEnabled false)"
    CLOUDREVE_BACKUP_PATH="$(cfg "$CONFIG_JSON" cloudreveBackupsPath backups/plataforma)"
    log "Config desde API: backupHour=${BACKUP_HOUR} retentionDays=${RETENTION_DAYS} maxAgeHours=${MAX_AGE_HOURS} cloudreve=${CLOUDREVE_BACKUP_ENABLED} drive=${DRIVE_BACKUP_ENABLED}"
  else
    BACKUP_HOUR=3
    RETENTION_DAYS=30
    MAX_AGE_HOURS=36
    DRIVE_BACKUP_ENABLED=false
    CLOUDREVE_BACKUP_ENABLED=false
    CLOUDREVE_BACKUP_PATH="backups/plataforma"
    log "API /api/backups/config no respondió, usando defaults"
  fi

  # Calcular cuánto falta para la próxima BACKUP_HOUR UTC
  current_ts=$(date -u '+%s')

  target_date_utc=$(date -u '+%Y-%m-%d')
  target_ts=$(date -u -d "${target_date_utc} ${BACKUP_HOUR}:00:00 UTC" '+%s' 2>/dev/null || echo 0)

  if [ "$target_ts" -le "$current_ts" ]; then
    target_ts=$(date -u -d "${target_date_utc} ${BACKUP_HOUR}:00:00 UTC + 1 day" '+%s' 2>/dev/null || echo 0)
  fi

  sleep_seconds=$(( target_ts - current_ts ))
  if [ "$sleep_seconds" -lt 0 ]; then
    sleep_seconds=86400
  fi

  sleep_hours=$(( sleep_seconds / 3600 ))
  sleep_minutes=$(( (sleep_seconds % 3600) / 60 ))
  log "Próximo backup en ${sleep_hours}h ${sleep_minutes}m (${BACKUP_HOUR}:00 UTC, ret=${RETENTION_DAYS}d)"
  sleep "$sleep_seconds"

  log "=== INICIANDO BACKUP DIARIO ==="

  if [ -x "$ORCHESTRATOR" ]; then
    RETENTION_DAYS="${RETENTION_DAYS}" \
      DRIVE_BACKUP_ENABLED="${DRIVE_BACKUP_ENABLED}" \
      CLOUDREVE_BACKUP_ENABLED="${CLOUDREVE_BACKUP_ENABLED}" \
      CLOUDREVE_BACKUP_PATH="${CLOUDREVE_BACKUP_PATH}" \
      "$ORCHESTRATOR" || error "Orquestador falló con exit code $?"

    # Notificar al endpoint de backup-health internamente
    if [ -n "${CRON_SECRET:-}" ]; then
      wget -qO- --header="Authorization: Bearer ${CRON_SECRET}" \
        "${APP_URL}/api/cron/backup-health" &>/dev/null || true
    fi
  else
    error "Orquestador no encontrado o no ejecutable: ${ORCHESTRATOR}"
  fi

  # ── Ensayo de restauración (RES-001) ────────────────────────────────────
  # Semanal, justo después del respaldo del día: se ensaya el artefacto recién
  # publicado, que es el que alguien restauraría si hoy hubiera un desastre.
  # Su resultado lo recoge `backup-verify.sh`, así que no necesita canal propio.
  if [ "$(date -u '+%u')" = "${RESTORE_DRILL_WEEKDAY:-7}" ]; then
    if [ -x "$DRILL_SCRIPT" ]; then
      log "=== ENSAYO DE RESTAURACIÓN ==="
      "$DRILL_SCRIPT" || error "El ensayo de restauración terminó con exit code $? (queda registrado para backup-verify)"
    else
      error "Ensayo de restauración no encontrado o no ejecutable: ${DRILL_SCRIPT}"
    fi
  fi

  log "=== BACKUP DIARIO COMPLETADO ==="
done
