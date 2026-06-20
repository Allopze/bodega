#!/usr/bin/env bash
set -euo pipefail

# ── PostgreSQL daily backup script ──────────────────────────────────────────
# Usage:  ./scripts/backup-pg.sh                  # uses defaults
#         DATABASE_URL=postgres://... ./scripts/backup-pg.sh   # override target
#
# Intended to run via cron:
#   0 3 * * * /srv/bodega/scripts/backup-pg.sh >> /var/log/bodega-backup.log 2>&1
#
# Creates:  /srv/bodega/backups/pg/bodega-YYYY-MM-DD-HHMMSS.dump
#           /srv/bodega/backups/pg/bodega-latest.dump        (symlink)
#
# Retention: keeps the last 30 daily backups in the directory, plus the
# "latest" symlink for quick restore. Cleanup is automatic.
# ──────────────────────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/srv/bodega/backups/pg}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP="$(date '+%Y-%m-%d-%H%M%S')"
BACKUP_FILE="${BACKUP_DIR}/bodega-${TIMESTAMP}.dump"
LATEST_LINK="${BACKUP_DIR}/bodega-latest.dump"

mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting PostgreSQL backup..."

# Use the DATABASE_URL from env, or prompt drizzle/config fallback
# If neither is set, the script fails early (which is correct — you
# don't want cron to silently skip backups).
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Cannot proceed."
  exit 1
fi

# pg_dump with custom format (compressed, parallel-restore ready)
pg_dump "${DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --verbose \
  --file="${BACKUP_FILE}" 2>&1

# Create / update the "latest" symlink for easy reference
ln -sf "bodega-${TIMESTAMP}.dump" "$LATEST_LINK"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete: ${BACKUP_FILE}"
echo "File size: $(du -h "${BACKUP_FILE}" | cut -f1)"

# ── Retention cleanup ───────────────────────────────────────────────────────
find "$BACKUP_DIR" -name 'bodega-*.dump' -type f -mtime "+${RETENTION_DAYS}" \
  -exec rm -v {} \; 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleanup complete (retention: ${RETENTION_DAYS} days)"
echo "---"
