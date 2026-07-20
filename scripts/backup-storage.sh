#!/usr/bin/env bash
set -euo pipefail

# ── Storage volume backup script ────────────────────────────────────────────
# Usage:  ./scripts/backup-storage.sh
#         RCLONE_DEST=s3:my-bucket/bodega-storage ./scripts/backup-storage.sh
#
# Requires rclone to be installed and configured (rclone config).
# For S3, Backblaze B2, or any rclone-supported backend.
#
# Intended to run via cron AFTER the pg backup (storage changes less often):
#   0 4 * * * /srv/bodega/scripts/backup-storage.sh >> /var/log/bodega-backup.log 2>&1
# ──────────────────────────────────────────────────────────────────────────────

STORAGE_PATH="${STORAGE_PATH:-/srv/bodega/storage}"
RCLONE_DEST="${RCLONE_DEST:-}"
TIMESTAMP="$(date '+%Y-%m-%d-%H%M%S')"
LOG_FILE="${LOG_FILE:-/var/log/bodega-storage-backup.log}"

if [ ! -d "$STORAGE_PATH" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: Storage path ${STORAGE_PATH} does not exist. Skipping."
  exit 0
fi

if [ -z "$RCLONE_DEST" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: RCLONE_DEST not set. Skipping remote backup."
  echo "  Set RCLONE_DEST, e.g.: RCLONE_DEST=s3:my-bucket/bodega-storage"
  echo "  For a local copy, consider: rsync -a ${STORAGE_PATH}/ /srv/bodega/backups/storage/"
  echo "  NOTE: This is informational only — no backup was performed."
  echo "---"
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting storage backup..."
echo "  Source: ${STORAGE_PATH}"
echo "  Destination: ${RCLONE_DEST}"

# rclone copy — copies only what changed (incremental), does NOT delete extraneous
# files at the destination. Use separate cleanup jobs for retention management.
rclone copy "$STORAGE_PATH" "$RCLONE_DEST" \
  --verbose \
  --progress \
  --checksum \
  --exclude '.health-*.tmp' \
  2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Storage backup complete."
echo "---"
