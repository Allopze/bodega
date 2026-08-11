#!/usr/bin/env bash
set -euo pipefail

# ── Production deploy (build local + retag) ─────────────────────────────────
# Usage:  npm run deploy:prod
#         PROD_DIR=/server/plataforma npm run deploy:prod   # override target
#
# Prod and this checkout share the same Docker daemon, so there is no GHCR
# push/pull in this flow: build the image here on `main`, then swap it in at
# PROD_DIR. Steps: tag current image as rollback -> pg_dump -> build -> migrate
# -> recreate app then cron containers -> authenticated smoke check.
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

echo "==> Syncing versioned Docker Compose definition"
mkdir -p "$PROD_DIR/backups"
compose_backup=""
if [ -f "$PROD_DIR/docker-compose.yml" ] && ! cmp -s docker-compose.yml "$PROD_DIR/docker-compose.yml"; then
  compose_backup="$PROD_DIR/backups/docker-compose-predeploy-$(date +%F-%H%M%S).yml"
  cp "$PROD_DIR/docker-compose.yml" "$compose_backup"
  echo "    saved previous Compose definition: $compose_backup"
fi
cp docker-compose.yml "$PROD_DIR/docker-compose.yml"

echo "==> Tagging current image as rollback ($PREV_IMAGE)"
HAS_PREVIOUS_IMAGE=0
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker tag "$IMAGE" "$PREV_IMAGE"
  HAS_PREVIOUS_IMAGE=1
else
  echo "    (no existing $IMAGE found, skipping)"
fi

# The deployment can fail after app replacement for reasons that the first
# health probe does not cover (cron image, container health or authenticated
# smoke). Restore both consumers and the prior Compose definition in that
# case. Migrations remain additive; after encrypted-only conversion the
# operator must choose a rollback-floor image compatible with the keyring.
ROLLBACK_ARMED=0
rollback_release() {
  deploy_status=$?
  trap - EXIT
  if [ "$deploy_status" -eq 0 ] || [ "$ROLLBACK_ARMED" -ne 1 ]; then
    exit "$deploy_status"
  fi

  set +e
  echo "==> Release verification failed. Rolling back app and cron"
  (cd "$PROD_DIR" && docker compose logs --tail=50 app cron)
  if [ "$CUTOVER_STATE" = "encrypted_only" ]; then
    echo "    encrypted-only DTE cutover detected; automatic rollback to the previous image is refused. Deploy a pinned compatible rollback floor with the keyring retained."
  elif [ "$CUTOVER_STATE" = "unknown" ]; then
    echo "    DTE cutover state could not be verified; automatic rollback is refused. Choose a compatible rollback floor manually."
  elif [ "$HAS_PREVIOUS_IMAGE" -eq 1 ]; then
    docker tag "$PREV_IMAGE" "$IMAGE"
    if [ -n "$compose_backup" ] && [ -f "$compose_backup" ]; then
      cp "$compose_backup" "$PROD_DIR/docker-compose.yml"
    fi
    (cd "$PROD_DIR" && docker compose up -d --no-deps --force-recreate app)
    (cd "$PROD_DIR" && docker compose up -d --no-deps --force-recreate cron)
    sleep 5
    if curl -sf http://127.0.0.1:3000/api/health; then
      echo "    rollback restored $PREV_IMAGE"
    else
      echo "    rollback healthcheck also failed; manual intervention required."
      (cd "$PROD_DIR" && docker compose logs --tail=50 app cron)
    fi
  else
    echo "    no previous image exists; manual intervention required."
  fi
  exit "$deploy_status"
}
trap rollback_release EXIT

echo "==> Dumping production database"
dump_file="$PROD_DIR/backups/prod-$(date +%F-%H%M).dump"
(cd "$PROD_DIR" && docker compose exec -T db pg_dump -U bodega -Fc bodega) > "$dump_file"
echo "    saved: $dump_file ($(du -h "$dump_file" | cut -f1))"

echo "==> Building image from $(pwd) (main)"
docker build --target prod -t "$IMAGE" .

echo "==> Applying migrations"
(cd "$PROD_DIR" && docker compose run --rm migrate)

echo "==> Syncing RBAC permissions from module manifests"
(cd "$PROD_DIR" && docker compose run --rm sync-rbac)

# The durable database marker, not merely a host env var, determines whether
# the immediately previous image is safe. A failed probe is deliberately
# conservative: after the app has been replaced, an operator must choose a
# known encryption-compatible rollback floor instead of reviving a legacy tag.
CUTOVER_STATE="$(cd "$PROD_DIR" && docker compose exec -T db psql -U "${POSTGRES_USER:-bodega}" -d "${POSTGRES_DB:-bodega}" -tAc "SELECT CASE WHEN EXISTS (SELECT 1 FROM system_settings WHERE key = 'dte.encryption_mode' AND value = 'encrypted_only') THEN 'encrypted_only' ELSE 'compat' END" 2>/dev/null | tr -d '[:space:]' || true)"
if [ "$CUTOVER_STATE" != "compat" ] && [ "$CUTOVER_STATE" != "encrypted_only" ]; then
  CUTOVER_STATE="unknown"
fi
echo "==> DTE cutover state: $CUTOVER_STATE"

echo "==> Recreating app container"
ROLLBACK_ARMED=1
(cd "$PROD_DIR" && docker compose up -d --no-deps --force-recreate app)

echo "==> Health check"
sleep 5
curl -sf http://127.0.0.1:3000/api/health
echo "==> Recreating cron container"
(cd "$PROD_DIR" && docker compose up -d --no-deps --force-recreate cron)
app_containers=$(cd "$PROD_DIR" && docker compose ps -q app)
cron_containers=$(cd "$PROD_DIR" && docker compose ps -q cron)
test -n "$app_containers"
test -n "$cron_containers"
# Todas las réplicas app deben llevar el mismo release compatible con sobres
# antes de que un operador pueda ejecutar el corte. Cron queda deliberadamente
# singleton: escalarlo duplicaría las sincronizaciones programadas.
for app_container in $app_containers; do
  test "$(docker inspect --format '{{.Config.Image}}' "$app_container")" = "$IMAGE"
done
set -- $cron_containers
test "$#" -eq 1
cron_container="$1"
test "$(docker inspect --format '{{.Config.Image}}' "$cron_container")" = "$IMAGE"
for attempt in $(seq 1 12); do
  if [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cron_container")" = "healthy" ]; then
    break
  fi
  sleep 5
done
test "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cron_container")" = "healthy"
# Read-only protected evaluator smoke. It does not call either sync route and
# keeps CRON_SECRET inside the app container process.
(cd "$PROD_DIR" && docker compose exec -T app node -e '
  const secret = process.env.CRON_SECRET
  if (!secret) process.exit(1)
  fetch("http://127.0.0.1:3000/api/cron/dte-sync-health", { headers: { Authorization: `Bearer ${secret}` } })
    .then(async (response) => {
      const body = await response.json().catch(() => null)
      if (!response.ok || !body || typeof body.code !== "string") process.exit(1)
    })
    .catch(() => process.exit(1))
')
ROLLBACK_ARMED=0
trap - EXIT
echo
echo "Deploy complete: app and cron use $IMAGE."

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
