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
# PREV-I13-E: también ensaya el tar de storage del último snapshot
# (${BACKUP_DIR}/snapshots/<fecha>/storage.tar.gz): sha256 contra el manifiesto,
# `tar -tzf` legible, conteo contra `file_count` y, si la base se restauró, que
# cada archivo que la base referencia (evidencia PDTP, plan de acción, planos de
# riesgo, evidencia de inspecciones) esté dentro del tar.
#
# Exit codes (mismos que backup-verify.sh):
#   0 = OK   1 = WARNING (no se pudo ensayar, o faltan referencias en el tar)
#   2 = CRITICAL (el dump no restaura, o el tar de storage está roto)
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
DB_RESTORED=false
STORAGE_TAR=""
STORAGE_TAR_FILES=0
STORAGE_SHA_OK=false
REFERENCES_CHECKED=0
REFERENCES_MISSING=0
STORAGE_LIST=""

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

# ── 1b. El tar de storage (PREV-I13-E) ──────────────────────────────────────
# El mismo snapshot que publicó el orquestador. No depende de la base de
# ensayo: un tar roto se detecta aunque no haya dónde restaurar el dump.

manifest_field() {
  # $1 = manifiesto, $2 = campo de components.storage. Vacío si no está.
  MANIFEST_PATH="$1" FIELD="$2" node --input-type=module -e '
    import { readFileSync } from "node:fs"
    try {
      const value = JSON.parse(readFileSync(process.env.MANIFEST_PATH, "utf8"))?.components?.storage?.[process.env.FIELD]
      if (value !== undefined && value !== null) process.stdout.write(String(value))
    } catch {}
  ' 2>/dev/null || true
}

LATEST_SNAPSHOT=""
if [ -d "${BACKUP_DIR}/snapshots" ]; then
  LATEST_SNAPSHOT=$(find "${BACKUP_DIR}/snapshots" -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' | sort | tail -1)
fi

if [ -z "$LATEST_SNAPSHOT" ] || [ ! -f "${LATEST_SNAPSHOT}/storage.tar.gz" ]; then
  fail_critical "No hay tar de storage que ensayar en ${BACKUP_DIR}/snapshots/<fecha>/storage.tar.gz"
elif [ ! -f "${LATEST_SNAPSHOT}/manifest.json" ]; then
  fail_critical "El snapshot ${LATEST_SNAPSHOT##*/} no tiene manifest.json: no hay contra qué verificar el tar de storage"
else
  STORAGE_TAR="${LATEST_SNAPSHOT}/storage.tar.gz"
  EXPECTED_SHA=$(manifest_field "${LATEST_SNAPSHOT}/manifest.json" sha256)
  EXPECTED_COUNT=$(manifest_field "${LATEST_SNAPSHOT}/manifest.json" file_count)
  ACTUAL_SHA=$(sha256sum "$STORAGE_TAR" | cut -d' ' -f1)

  if [ -z "$EXPECTED_SHA" ]; then
    fail_warning "El manifiesto de ${LATEST_SNAPSHOT##*/} declara el storage omitido (sin sha256): ese respaldo no trae evidencia"
  elif [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    fail_critical "El sha256 del tar de storage (${ACTUAL_SHA}) no coincide con el del manifiesto (${EXPECTED_SHA}): el archivo cambió o se corrompió"
  else
    STORAGE_SHA_OK=true
    log "OK: sha256 del tar de storage coincide con el manifiesto"
  fi

  if [ -n "$EXPECTED_SHA" ]; then
    STORAGE_LIST=$(mktemp)
    if tar -tzf "$STORAGE_TAR" >"$STORAGE_LIST" 2>/dev/null; then
      STORAGE_TAR_FILES=$(grep -vc '/$' "$STORAGE_LIST" || true)
      log "OK: tar -tzf lista ${STORAGE_TAR_FILES} archivos"
      if [ -n "$EXPECTED_COUNT" ] && [ "$EXPECTED_COUNT" != "$STORAGE_TAR_FILES" ]; then
        fail_critical "El tar de storage lista ${STORAGE_TAR_FILES} archivos y el manifiesto declara file_count=${EXPECTED_COUNT}"
      fi
    else
      fail_critical "tar -tzf no puede leer ${STORAGE_TAR##*/}: el tar de storage está corrupto"
      rm -f "$STORAGE_LIST"
      STORAGE_LIST=""
    fi
  fi
fi

# ── 2. Prerrequisitos ────────────────────────────────────────────────────────
# Sin base desechable o sin herramientas el ensayo no se hizo. Eso es WARNING,
# no OK: un ensayo que no corre no prueba nada, pero tampoco prueba que el
# respaldo esté roto.

# Un tar de storage roto no impide ensayar el dump: son artefactos distintos y
# conviene saber de los dos. Lo único que corta el ensayo es no tener dump.
if [ -n "$DUMP_PATH" ] && [ -f "$DUMP_PATH" ]; then
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

      DB_EXIT_BEFORE=$EXIT_CODE
      if [ "${TABLES_RESTORED:-0}" -lt "$DRILL_MIN_TABLES" ]; then
        fail_critical "La restauración dejó ${TABLES_RESTORED} tablas (mínimo esperado: ${DRILL_MIN_TABLES}): el respaldo NO es restaurable"
      else
        log "OK: ${TABLES_RESTORED} tablas restauradas"
      fi

      # Que las tablas existan no basta: un dump truncado restaura el esquema y
      # se queda sin datos. `users` nunca está vacía en una base real.
      if [ "$EXIT_CODE" -le "$DB_EXIT_BEFORE" ]; then
        USER_ROWS=$(psql "$DRILL_DATABASE_URL" -tAc "SELECT count(*) FROM users" 2>/dev/null || echo -1)
        if [ "${USER_ROWS:--1}" -lt 0 ]; then
          fail_critical "La tabla users no existe en lo restaurado: el respaldo NO es restaurable"
        elif [ "${USER_ROWS}" -eq 0 ]; then
          fail_critical "Lo restaurado no tiene ni un usuario: el dump trae esquema pero no datos"
        else
          log "OK: datos presentes (${USER_ROWS} usuarios)"
          DB_RESTORED=true
        fi
      fi

      rm -f "$RESTORE_LOG"
      trap - EXIT
    fi
  fi
fi

# ── 3b. Referencias de la base restaurada contra el tar (PREV-I13-E) ─────────
# Lo que la base referencia y el tar no trae es evidencia que este respaldo no
# puede devolver. Es WARNING y no CRITICAL: puede faltar ya en el storage vivo
# (lo alerta el escaneo `pdtp-evidence-integrity`), y en ese caso ningún
# respaldo la tendría. Las rutas se comparan sin su primer componente
# (`storage/…`), que depende del nombre del directorio respaldado.

if $DB_RESTORED && [ -n "$STORAGE_LIST" ] && [ -f "$STORAGE_LIST" ]; then
  REFERENCES_SQL="SELECT DISTINCT p FROM (
      SELECT evidence_url AS p FROM pdtp_executions
      UNION ALL SELECT jsonb_array_elements_text(evidence_photos) FROM pdtp_executions WHERE jsonb_typeof(evidence_photos) = 'array'
      UNION ALL SELECT reference FROM prevention_capa_evidence
      UNION ALL SELECT source_metadata_json->>'evidenceRef' FROM pdtp_scheduled_instances
      UNION ALL SELECT image_path FROM prevention_risk_map_layouts
      UNION ALL SELECT path FROM prevention_inspection_answer_evidence
    ) refs WHERE p LIKE 'storage/%'"
  REFS_FILE=$(mktemp)
  if psql "$DRILL_DATABASE_URL" -tAc "$REFERENCES_SQL" >"$REFS_FILE" 2>/dev/null; then
    TAR_KEYS=$(mktemp)
    grep -v '/$' "$STORAGE_LIST" | sed -E 's#^\./##; s#^[^/]+/##' | sort -u >"$TAR_KEYS"
    MISSING_FILE=$(mktemp)
    sed -E '/^$/d; s#^[^/]+/##' "$REFS_FILE" | sort -u | comm -23 - "$TAR_KEYS" >"$MISSING_FILE"
    REFERENCES_CHECKED=$(sed '/^$/d' "$REFS_FILE" | sort -u | wc -l | tr -d ' ')
    REFERENCES_MISSING=$(wc -l <"$MISSING_FILE" | tr -d ' ')
    if [ "$REFERENCES_MISSING" -gt 0 ]; then
      SAMPLE=$(head -5 "$MISSING_FILE" | tr '\n' ' ' | sed 's/ $//')
      fail_warning "${REFERENCES_MISSING} de ${REFERENCES_CHECKED} archivos referenciados por la base no están en el tar de storage (muestra: ${SAMPLE})"
    else
      log "OK: los ${REFERENCES_CHECKED} archivos referenciados por la base están en el tar de storage"
    fi
    rm -f "$TAR_KEYS" "$MISSING_FILE"
  else
    fail_warning "No se pudieron leer las referencias a archivos de la base restaurada: el cruce con el tar de storage no se hizo"
  fi
  rm -f "$REFS_FILE"
fi
if [ -n "$STORAGE_LIST" ]; then rm -f "$STORAGE_LIST"; fi

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
  "storage": {
    "tar": "${STORAGE_TAR#"${BACKUP_DIR}"/}",
    "files": ${STORAGE_TAR_FILES:-0},
    "sha256_ok": ${STORAGE_SHA_OK},
    "references_checked": ${REFERENCES_CHECKED:-0},
    "references_missing": ${REFERENCES_MISSING:-0}
  },
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
