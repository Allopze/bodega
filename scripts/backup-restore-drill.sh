#!/usr/bin/env bash
set -euo pipefail

# ── Backup Restore Drill — ensayo programado de restauración ──────────────────
#
# `RES-001` (auditoría 2026-09-14). La verificación diaria comprueba que el dump
# exista, pese lo suyo y que la passphrase abra el snapshot; lo que nunca se
# comprobaba es que el dump **se pueda restaurar**. Un dump truncado por un disco
# lleno a mitad de escritura pasa las tres comprobaciones y sólo se descubre el
# día que hay que usarlo.
#
# Esto restaura el dump real de producción en una base desechable y comprueba
# que lo restaurado se parece a lo respaldado. `dev-backup-test.sh` ya sabía
# hacer el ciclo, pero es una herramienta manual de desarrollo que respalda la
# base local: esto ensaya el artefacto que de verdad se guardaría.
#
# Uso:
#   ./scripts/backup-restore-drill.sh            # informe legible
#   ./scripts/backup-restore-drill.sh --json     # salida JSON
#
# Deja SIEMPRE su resultado en ${BACKUP_DIR}/restore-drill.json, que
# `backup-verify.sh` lee: así el ensayo llega al mismo canal que el resto del
# monitoreo de respaldos, sin plomería nueva.
#
# Variables:
#   BACKUP_DIR            (/srv/bodega/backups)
#   DRILL_DATABASE_URL    base desechable donde restaurar. Su esquema `public`
#                         se DESTRUYE en cada ensayo: nunca apuntar a producción.
#   DRILL_MIN_TABLES      mínimo de tablas esperadas tras restaurar (80)
#
# Exit codes (mismos que backup-verify.sh):
#   0 = OK   1 = WARNING (no se pudo ensayar)   2 = CRITICAL (el dump no restaura)
# ──────────────────────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/srv/bodega/backups}"
DRILL_DATABASE_URL="${DRILL_DATABASE_URL:-}"
DRILL_MIN_TABLES="${DRILL_MIN_TABLES:-80}"
RESULT_FILE="${RESTORE_DRILL_RESULT_FILE:-${BACKUP_DIR}/restore-drill.json}"

JSON_OUTPUT=false
for arg in "$@"; do
  case "$arg" in
    --json) JSON_OUTPUT=true ;;
  esac
done

log()   { if $JSON_OUTPUT; then echo "$*" >&2; else echo "$*"; fi; }

EXIT_CODE=0
ISSUES=()
TABLES_RESTORED=0
DUMP_PATH=""

fail_critical() { ISSUES+=("$1"); EXIT_CODE=2; }
fail_warning()  { ISSUES+=("$1"); [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1 || true; }

# ── 1. El artefacto a ensayar ────────────────────────────────────────────────
# El mismo que restauraría una persona el día del desastre: el `latest` que
# publica el orquestador, no un dump recién hecho para la ocasión.

LATEST_PG="${BACKUP_DIR}/pg/bodega-latest.dump"
if [ -L "$LATEST_PG" ] || [ -f "$LATEST_PG" ]; then
  if [ -L "$LATEST_PG" ]; then
    DUMP_PATH="${BACKUP_DIR}/pg/$(readlink "$LATEST_PG")"
  else
    DUMP_PATH="$LATEST_PG"
  fi
fi

if [ -z "$DUMP_PATH" ] || [ ! -f "$DUMP_PATH" ]; then
  fail_critical "No hay dump que ensayar en ${LATEST_PG}"
fi

# ── 2. Prerrequisitos ────────────────────────────────────────────────────────
# Sin base desechable o sin herramientas el ensayo no se hizo. Eso es WARNING,
# no OK: un ensayo que no corre no prueba nada, pero tampoco prueba que el
# respaldo esté roto.

if [ "$EXIT_CODE" -lt 2 ]; then
  if [ -z "$DRILL_DATABASE_URL" ]; then
    fail_warning "DRILL_DATABASE_URL no configurada: el ensayo de restauración no se ejecutó"
  elif ! command -v pg_restore >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
    fail_warning "pg_restore/psql no disponibles en este host: el ensayo de restauración no se ejecutó"
  elif ! psql "$DRILL_DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
    fail_warning "La base de ensayo no responde: el ensayo de restauración no se ejecutó"
  else
    # ── 3. El ensayo ─────────────────────────────────────────────────────────
    if ! pg_restore --list "$DUMP_PATH" >/dev/null 2>&1; then
      fail_critical "El dump ${DUMP_PATH##*/} no tiene estructura válida: pg_restore no puede leer su índice"
    else
      psql "$DRILL_DATABASE_URL" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1 \
        || fail_warning "No se pudo limpiar el esquema de la base de ensayo"

      RESTORE_LOG=$(mktemp)
      trap 'rm -f "$RESTORE_LOG"' EXIT
      if pg_restore --clean --if-exists --no-owner --no-acl \
           --dbname="$DRILL_DATABASE_URL" "$DUMP_PATH" >"$RESTORE_LOG" 2>&1; then
        log "OK: pg_restore completó sin errores"
      else
        # pg_restore devuelve != 0 también por avisos benignos (DROP de objetos
        # inexistentes con --clean). Lo que decide es si quedó una base usable.
        log "WARN: pg_restore terminó con avisos ($(wc -l <"$RESTORE_LOG") líneas)"
      fi

      TABLES_RESTORED=$(psql "$DRILL_DATABASE_URL" -tAc \
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" 2>/dev/null || echo 0)

      if [ "${TABLES_RESTORED:-0}" -lt "$DRILL_MIN_TABLES" ]; then
        fail_critical "La restauración dejó ${TABLES_RESTORED} tablas (mínimo esperado: ${DRILL_MIN_TABLES}): el respaldo NO es restaurable"
      else
        log "OK: ${TABLES_RESTORED} tablas restauradas"
      fi

      # Que las tablas existan no basta: un dump truncado restaura el esquema y
      # se queda sin datos. `users` nunca está vacía en una base real.
      if [ "$EXIT_CODE" -lt 2 ]; then
        USER_ROWS=$(psql "$DRILL_DATABASE_URL" -tAc "SELECT count(*) FROM users" 2>/dev/null || echo -1)
        if [ "${USER_ROWS:--1}" -lt 0 ]; then
          fail_critical "La tabla users no existe en lo restaurado: el respaldo NO es restaurable"
        elif [ "${USER_ROWS}" -eq 0 ]; then
          fail_critical "Lo restaurado no tiene ni un usuario: el dump trae esquema pero no datos"
        else
          log "OK: datos presentes (${USER_ROWS} usuarios)"
        fi
      fi

      rm -f "$RESTORE_LOG"
      trap - EXIT
    fi
  fi
fi

# ── 4. Resultado, al canal de siempre ────────────────────────────────────────

STATUS="OK"
[ "$EXIT_CODE" -eq 1 ] && STATUS="WARNING"
[ "$EXIT_CODE" -eq 2 ] && STATUS="CRITICAL"

ISSUES_JSON="[]"
if [ ${#ISSUES[@]} -gt 0 ]; then
  ISSUES_JSON=$(printf '%s\n' "${ISSUES[@]}" | RESTORE_DRILL_ISSUES="$(printf '%s\n' "${ISSUES[@]}")" \
    node --input-type=module -e 'process.stdout.write(JSON.stringify((process.env.RESTORE_DRILL_ISSUES ?? "").split("\n").filter(Boolean)))' 2>/dev/null \
    || echo '[]')
fi

mkdir -p "$(dirname "$RESULT_FILE")" 2>/dev/null || true
cat > "$RESULT_FILE" <<JSON
{
  "status": "${STATUS}",
  "exit_code": ${EXIT_CODE},
  "tables_restored": ${TABLES_RESTORED:-0},
  "dump": "${DUMP_PATH##*/}",
  "issues": ${ISSUES_JSON},
  "checked_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
JSON

if $JSON_OUTPUT; then
  cat "$RESULT_FILE"
else
  log ""
  log "=== ENSAYO DE RESTAURACIÓN: ${STATUS} ==="
  for issue in ${ISSUES[@]+"${ISSUES[@]}"}; do
    log "  - ${issue}"
  done
  log "Resultado en ${RESULT_FILE}"
fi

exit "$EXIT_CODE"
