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
  local backup_hour=3
  local retention_days=30
  local max_age_hours=36

  if [ -n "${CRON_SECRET:-}" ]; then
    local resp
    resp=$(wget -qO- --timeout=10 \
      --header="Authorization: Bearer ${CRON_SECRET}" \
      "${APP_URL}/api/backups/config" 2>/dev/null || echo "")

    if [ -n "$resp" ]; then
      backup_hour=$(echo "$resp" | jq -r '.backupHour // 3' 2>/dev/null || echo 3)
      retention_days=$(echo "$resp" | jq -r '.retentionDays // 30' 2>/dev/null || echo 30)
      max_age_hours=$(echo "$resp" | jq -r '.maxAgeHours // 36' 2>/dev/null || echo 36)
      log "Config desde API: backupHour=${backup_hour} retentionDays=${retention_days} maxAgeHours=${max_age_hours}"
    else
      log "API /api/backups/config no respondió, usando defaults"
    fi
  else
    log "CRON_SECRET no configurado, usando defaults"
  fi

  echo "${backup_hour} ${retention_days} ${max_age_hours}"
}

while true; do
  # Obtener configuración actualizada cada ciclo
  read -r BACKUP_HOUR RETENTION_DAYS MAX_AGE_HOURS <<< "$(fetch_config)"
  BACKUP_HOUR="${BACKUP_HOUR:-3}"
  RETENTION_DAYS="${RETENTION_DAYS:-30}"
  MAX_AGE_HOURS="${MAX_AGE_HOURS:-36}"

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
    RETENTION_DAYS="${RETENTION_DAYS}" "$ORCHESTRATOR" || error "Orquestador falló con exit code $?"

    # Notificar al endpoint de backup-health internamente
    if [ -n "${CRON_SECRET:-}" ]; then
      wget -qO- --header="Authorization: Bearer ${CRON_SECRET}" \
        "${APP_URL}/api/cron/backup-health" &>/dev/null || true
    fi
  else
    error "Orquestador no encontrado o no ejecutable: ${ORCHESTRATOR}"
  fi

  log "=== BACKUP DIARIO COMPLETADO ==="
done
