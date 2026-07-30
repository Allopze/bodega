#!/usr/bin/env bash
set -euo pipefail

# ── Production deploy (build local + retag) ─────────────────────────────────
# Usage:  npm run deploy:prod
#         PROD_DIR=/server/plataforma npm run deploy:prod   # override target
#
# Prod and this checkout share the same Docker daemon, so there is no GHCR
# push/pull in this flow: build the image here on `main`, then swap it in at
# PROD_DIR. Steps: tag current image as rollback -> pg_dump -> build -> migrate
# -> recreate app container -> health check.
# ─────────────────────────────────────────────────────────────────────────────

PROD_DIR="${PROD_DIR:-/server/plataforma}"
IMAGE="${IMAGE:-ghcr.io/allopze/bodega:latest}"
PREV_IMAGE="${IMAGE%:*}:prev"

if [ ! -d "$PROD_DIR" ]; then
  echo "ERROR: PROD_DIR not found: $PROD_DIR"
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "ERROR: on branch '$branch', not 'main'. Switch to main before deploying."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is dirty. Commit or stash before deploying."
  exit 1
fi

echo "About to deploy $(git rev-parse --short HEAD) ($(git log -1 --format=%s)) to $PROD_DIR"
read -p "Continue? [y/N] " confirm
if [ "$confirm" != "y" ]; then
  echo "Aborted."
  exit 1
fi

echo "==> Tagging current image as rollback ($PREV_IMAGE)"
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker tag "$IMAGE" "$PREV_IMAGE"
else
  echo "    (no existing $IMAGE found, skipping)"
fi

echo "==> Dumping production database"
mkdir -p "$PROD_DIR/backups"
dump_file="$PROD_DIR/backups/prod-$(date +%F-%H%M).dump"
(cd "$PROD_DIR" && docker compose exec -T db pg_dump -U bodega -Fc bodega) > "$dump_file"
echo "    saved: $dump_file ($(du -h "$dump_file" | cut -f1))"

echo "==> Building image from $(pwd) (main)"
docker build --target prod -t "$IMAGE" .

echo "==> Applying migrations"
(cd "$PROD_DIR" && docker compose run --rm migrate)

echo "==> Syncing RBAC permissions from module manifests"
(cd "$PROD_DIR" && docker compose run --rm sync-rbac)

echo "==> Recreating app container"
(cd "$PROD_DIR" && docker compose up -d --no-deps app)

echo "==> Health check"
sleep 5
if curl -sf http://127.0.0.1:3000/api/health; then
  echo
  echo "Deploy complete."
else
  echo
  echo "Health check failed. Rollback with:"
  echo "  docker tag $PREV_IMAGE $IMAGE && (cd $PROD_DIR && docker compose up -d --no-deps app)"
  exit 1
fi

echo
echo "==> Verificando Base preventiva 2026..."

# Check if the PDTP base 2026 template is published by querying the DB.
# If not, print instructions for the one-time bootstrap.
BASE_CHECK=$( (cd "$PROD_DIR" && docker compose exec -T db psql -U bodega -d bodega -tAc \
  "SELECT pv.version FROM pdtp_program_templates pt \
   JOIN pdtp_program_template_versions pv ON pv.template_id = pt.id \
   WHERE pt.code = 'base_preventiva_2026' AND pt.is_active = true \
   ORDER BY pv.version DESC LIMIT 1" 2>/dev/null) || echo "")

if [ -z "$BASE_CHECK" ]; then
  echo "  ⚠️  Base preventiva 2026 NO PUBLICADA."
  echo
  echo "  Ejecuta el bootstrap UNA SOLA VEZ desde el checkout:"
  echo
  echo "    BOOTSTRAP_USER_ID=<admin-uuid> \\"
  echo "    PUBLISH_REFERENCE=true \\"
  echo "    DATABASE_URL=postgres://...  \\"
  echo "    npx tsx scripts/pdtp-bootstrap-prod.ts"
  echo
  echo "  O desde docker compose (mismo directorio que este script):"
  echo
  echo "    BOOTSTRAP_USER_ID=<admin-uuid> \\"
  echo "    docker compose --profile bootstrap run --rm bootstrap-pdtp"
  echo
  echo "  BOOTSTRAP_USER_ID debe ser el UUID de un admin global."
  echo "  Después del bootstrap, la UI en /prevencion/pdtp/nuevo"
  echo "  permitirá crear programas anuales normalmente."
  echo
else
  echo "  ✓ Base preventiva 2026 publicada (v${BASE_CHECK})."
fi
