#!/usr/bin/env bash
set -euo pipefail

# ── Production deploy (build local + ship over SSH) ─────────────────────────
# Usage:  npm run deploy:prod
#         PROD_SSH=usuario@host npm run deploy:prod          # override target
#         PROD_DIR=/srv/plataforma npm run deploy:prod       # override path
#
# Producción vive en OTRA máquina desde 2026-08-28 (antes compartía el daemon
# Docker con este checkout). La imagen se sigue construyendo acá, sobre `main`,
# pero ahora viaja por SSH y todo lo que toca prod pasa por `run_in_prod`.
# El servidor sólo se alcanza por el túnel de Cloudflare: el puerto 22 no está
# publicado, así que se entra con `cloudflared access ssh` como ProxyCommand.
# Steps: tag current image as rollback -> pg_dump -> build -> ship image ->
# preflight conciliación -> preflight combustible -> migrate -> backfill
# conciliación (si hace falta) -> backfill referencias OC en DTE (si hace falta)
# -> backfill lecturas de medidor -> catálogo de reglas de anomalía -> sync-rbac
# -> catálogo de inspecciones -> recreate app then cron containers ->
# authenticated smoke check.
# ─────────────────────────────────────────────────────────────────────────────

PROD_SSH="${PROD_SSH:-allopze@ssh.portalchome.cl}"
PROD_DIR="${PROD_DIR:-/srv/plataforma}"
PROD_SSH_KEY="${PROD_SSH_KEY:-$HOME/.ssh/id_ed25519_migracion}"
IMAGE="${IMAGE:-ghcr.io/allopze/bodega:latest}"
PREV_IMAGE="${IMAGE%:*}:prev"
BUILDER="${BUILDER:-chome-prod}"
DEPLOY_STARTED_SECONDS=$SECONDS

format_duration() {
  local duration_seconds="$1"
  printf '%dm%02ds' "$((duration_seconds / 60))" "$((duration_seconds % 60))"
}

run_timed() {
  local label="$1"
  shift
  local started_seconds=$SECONDS
  local status

  echo "==> $label"
  # Ejecutar un comando como condición de `if` desactiva `errexit` también
  # dentro de funciones shell llamadas desde aquí. El subshell reactiva `-e`
  # para que un pg_dump, una migración o un healthcheck fallen en el primer
  # comando no exitoso; afuera capturamos el estado para poder informar tiempo.
  set +e
  (set -e; "$@")
  status=$?
  set -e

  if [ "$status" -ne 0 ]; then
    echo "    failed after $(format_duration "$((SECONDS - started_seconds))")"
    return "$status"
  fi

  echo "    completed in $(format_duration "$((SECONDS - started_seconds))")"
}

prod_ssh_opts=(-o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 -i "$PROD_SSH_KEY")
case "${PROD_SSH#*@}" in
  # El registro está proxeado por Cloudflare, así que el 22 no pasa de largo.
  # Si algún día prod queda accesible por IP directa, esto se apaga solo.
  *.portalchome.cl) prod_ssh_opts+=(-o "ProxyCommand=cloudflared access ssh --hostname %h") ;;
esac

# Un comando suelto en el servidor de producción, sin `cd`.
prod_run() {
  ssh "${prod_ssh_opts[@]}" "$PROD_SSH" "$(printf '%q ' "$@")"
}

# Igual, pero desde $PROD_DIR: reemplazo directo del `(cd "$PROD_DIR" && ...)`
# de cuando prod corría en este mismo box.
run_in_prod() {
  ssh "${prod_ssh_opts[@]}" "$PROD_SSH" "cd $(printf '%q' "$PROD_DIR") && $(printf '%q ' "$@")"
}

# Un shell remoto entero, para cuando hace falta redirección o tubería del lado
# de allá (los otros dos citan los argumentos y romperían un `>` o un `|`).
prod_sh() {
  ssh "${prod_ssh_opts[@]}" "$PROD_SSH" "$1"
}

if ! prod_run test -d "$PROD_DIR"; then
  echo "ERROR: no se pudo entrar a $PROD_SSH o falta el directorio $PROD_DIR"
  echo "       Prueba: ssh ${prod_ssh_opts[*]} $PROD_SSH true"
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

echo "About to deploy $(git rev-parse --short HEAD) ($(git log -1 --format=%s)) to $PROD_SSH:$PROD_DIR"
read -p "Continue? [y/N] " confirm
if [ "$confirm" != "y" ]; then
  echo "Aborted."
  exit 1
fi

echo "==> Verifying persistent BuildKit builder ($BUILDER)"
if ! docker buildx inspect "$BUILDER" --bootstrap; then
  echo "ERROR: BuildKit builder '$BUILDER' is unavailable. Install docker-buildx-plugin and bootstrap the builder before deploying."
  exit 1
fi

echo "==> Syncing versioned Docker Compose definition"
prod_run mkdir -p "$PROD_DIR/backups"
compose_backup=""
# El compose remoto se compara por hash: traerlo entero para un `cmp` local
# costaría una ida y vuelta más por despliegue.
remote_compose_sum="$(prod_sh "md5sum $(printf '%q' "$PROD_DIR/docker-compose.yml") 2>/dev/null | cut -d' ' -f1" | tr -d '\r')"
if [ -n "$remote_compose_sum" ] && [ "$remote_compose_sum" != "$(md5sum docker-compose.yml | cut -d' ' -f1)" ]; then
  compose_backup="$PROD_DIR/backups/docker-compose-predeploy-$(date +%F-%H%M%S).yml"
  prod_run cp "$PROD_DIR/docker-compose.yml" "$compose_backup"
  echo "    saved previous Compose definition: $compose_backup"
fi
prod_sh "cat > $(printf '%q' "$PROD_DIR/docker-compose.yml")" < docker-compose.yml

echo "==> Tagging current image as rollback ($PREV_IMAGE)"
HAS_PREVIOUS_IMAGE=0
if prod_run docker image inspect "$IMAGE" >/dev/null 2>&1; then
  prod_run docker tag "$IMAGE" "$PREV_IMAGE"
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
  run_in_prod docker compose logs --tail=50 app cron
  if [ "$CUTOVER_STATE" = "encrypted_only" ]; then
    echo "    encrypted-only DTE cutover detected; automatic rollback to the previous image is refused. Deploy a pinned compatible rollback floor with the keyring retained."
  elif [ "$CUTOVER_STATE" = "unknown" ]; then
    echo "    DTE cutover state could not be verified; automatic rollback is refused. Choose a compatible rollback floor manually."
  elif [ "$HAS_PREVIOUS_IMAGE" -eq 1 ]; then
    prod_run docker tag "$PREV_IMAGE" "$IMAGE"
    if [ -n "$compose_backup" ] && prod_run test -f "$compose_backup"; then
      prod_run cp "$compose_backup" "$PROD_DIR/docker-compose.yml"
    fi
    run_in_prod docker compose up -d --no-deps --force-recreate app
    run_in_prod docker compose up -d --no-deps --force-recreate cron
    sleep 5
    if prod_run curl -sf http://127.0.0.1:3000/api/health; then
      echo "    rollback restored $PREV_IMAGE"
    else
      echo "    rollback healthcheck also failed; manual intervention required."
      run_in_prod docker compose logs --tail=50 app cron
    fi
  else
    echo "    no previous image exists; manual intervention required."
  fi
  exit "$deploy_status"
}
trap rollback_release EXIT

dump_production_database() {
  dump_file="$PROD_DIR/backups/prod-$(date +%F-%H%M).dump"
  # El respaldo se queda EN prod, que es donde sirve para el rollback; por eso
  # el `>` va dentro del shell remoto y no acá.
  prod_sh "cd $(printf '%q' "$PROD_DIR") && docker compose exec -T db pg_dump -U bodega -Fc bodega > $(printf '%q' "$dump_file")"
  echo "    saved: $PROD_SSH:$dump_file ($(prod_run du -h "$dump_file" | cut -f1))"
}

run_timed "Dumping production database" dump_production_database

run_timed "Building image from $(pwd) (main)" docker buildx build --builder "$BUILDER" --target prod --tag "$IMAGE" --load --progress=plain .

# Prod dejó de compartir el daemon Docker con este checkout, así que la imagen
# recién construida tiene que viajar.
# ponytail: `docker save` manda TODAS las capas en cada despliegue (~700 MB,
# unos 3 min por el túnel). Si eso llega a molestar, el reemplazo es push/pull
# contra GHCR, que sólo mueve las capas cambiadas, a cambio de dejar un PAT en
# el servidor.
ship_image_to_prod() {
  # Se compara por capas y no por `.Id`: con el almacén de imágenes de
  # containerd (Docker 29+) el ID se recalcula al cargar, así que una imagen
  # idéntica aterriza con otro ID y comparar por ID reenviaría todo cada vez.
  local fingerprint local_layers remote_layers
  fingerprint='{{range .RootFS.Layers}}{{.}}{{"\n"}}{{end}}'
  local_layers="$(docker image inspect "$IMAGE" --format "$fingerprint" | md5sum)"
  remote_layers="$(prod_sh "docker image inspect $(printf '%q' "$IMAGE") --format $(printf '%q' "$fingerprint") 2>/dev/null | md5sum" | tr -d '\r')"
  if [ "$local_layers" = "$remote_layers" ]; then
    echo "    producción ya tiene esta imagen; no se reenvía"
    return 0
  fi
  docker save "$IMAGE" | gzip -1 | prod_sh 'gunzip | docker load'
}

run_timed "Enviando la imagen a $PROD_SSH" ship_image_to_prod

# Read-only y sin depender de las columnas de proyección, así que corre antes
# de migrar: deja en el log del deploy cuánta deriva OC-factura traía la base.
run_timed "Diagnóstico de conciliación OC-factura (previo a migrar)" run_in_prod docker compose run --rm preflight-invoice-reconciliation

# También de sólo lectura y también antes de migrar: deja en el log cuántas
# transacciones con odómetro trae el detalle ya guardado, cuántas patentes no
# resuelven a un equipo y cuántas lecturas regresivas arrastra el histórico. Es
# la cifra con la que se contrasta el backfill de más abajo.
run_timed "Diagnóstico de integraciones de combustible (previo a migrar)" run_in_prod docker compose run --rm preflight-fuel-integrations

run_timed "Applying migrations" run_in_prod docker compose run --rm migrate

# El backfill recalcula tanto OC nunca proyectadas como huellas de una versión
# anterior. La versión 2 introduce estados parciales, así que conservar una
# huella v1 dejaría la pantalla y la cola con semántica antigua.
echo "==> Proyección de conciliación OC-factura"
pending_reconciliation="$(run_in_prod docker compose exec -T db psql -U "${POSTGRES_USER:-bodega}" -d "${POSTGRES_DB:-bodega}" -tAc "SELECT COUNT(*) FROM purchase_orders po WHERE (po.invoice_reconciliation_fingerprint IS NULL OR po.invoice_reconciliation_fingerprint NOT LIKE 'v2:%') AND EXISTS (SELECT 1 FROM purchase_order_invoices poi WHERE poi.purchase_order_id = po.id)" 2>/dev/null | tr -d '[:space:]' || true)"
case "$pending_reconciliation" in
  ''|*[!0-9]*)
    echo "    no se pudo contar OC pendientes; se ejecuta el backfill igual (es idempotente)"
    pending_reconciliation=1
    ;;
esac
if [ "$pending_reconciliation" -gt 0 ]; then
  echo "    $pending_reconciliation OC sin recalcular; ejecutando backfill"
  run_timed "Proyección de conciliación OC-factura" run_in_prod docker compose run --rm backfill-invoice-reconciliation
else
  echo "    proyección al día; backfill omitido"
fi

# La señal "el proveedor cita esta OC" sale del XML, y los DTE sincronizados
# antes de que existiera la columna la tienen sin leer. `referenced_order_codes`
# NULL significa exactamente eso —cadena vacía es "se leyó y no citaba nada"—,
# así que contar NULL con XML en disco es contar trabajo real pendiente.
echo "==> Referencias a OC en los DTE del histórico"
pending_dte_refs="$(run_in_prod docker compose exec -T db psql -U "${POSTGRES_USER:-bodega}" -d "${POSTGRES_DB:-bodega}" -tAc "SELECT COUNT(*) FROM dte_documents WHERE referenced_order_codes IS NULL AND xml_path IS NOT NULL" 2>/dev/null | tr -d '[:space:]' || true)"
case "$pending_dte_refs" in
  ''|*[!0-9]*)
    echo "    no se pudo contar DTE pendientes; se ejecuta el backfill igual (es idempotente)"
    pending_dte_refs=1
    ;;
esac
if [ "$pending_dte_refs" -gt 0 ]; then
  echo "    $pending_dte_refs DTE con XML sin examinar; ejecutando backfill"
  run_timed "Referencias a OC en los DTE del histórico" run_in_prod docker compose run --rm backfill-dte-order-refs
else
  echo "    referencias al día; backfill omitido"
fi

# Sin conteo previo y siempre: el backfill relee el detalle que ya está en
# `raw_row` y hace upsert por (fuente, guía), así que sobre una base al día no
# escribe nada. Contar lo pendiente costaría el mismo escaneo que hacerlo.
run_timed "Rescate de lecturas de odómetro del detalle de proveedor" run_in_prod docker compose run --rm backfill-fuel-meter-readings

# Después del backfill y antes de levantar la app: una regla que no existe como
# fila no dispara aunque su detector esté en el código, y el cron de detección
# corre a las 05:00 — sin este paso, el primer día tras el deploy no se detecta
# nada nuevo.
run_timed "Catálogo de reglas de anomalía de combustible" run_in_prod docker compose run --rm seed-fuel-anomaly-rules

run_timed "Syncing RBAC permissions from module manifests" run_in_prod docker compose run --rm sync-rbac

# Idempotente y antes del swap: si falla, el deploy aborta con la app anterior
# todavía en pie. Va acá y no después porque la app debe levantar con el
# catálogo ya cableado — una plantilla sin `pdtpActivityNumbers` ejecuta la
# inspección sin acreditar nada en el programa anual.
run_timed "Instalando el catálogo de inspecciones cableado al PDTP" run_in_prod docker compose run --rm seed-inspection-templates

# The durable database marker, not merely a host env var, determines whether
# the immediately previous image is safe. A failed probe is deliberately
# conservative: after the app has been replaced, an operator must choose a
# known encryption-compatible rollback floor instead of reviving a legacy tag.
CUTOVER_STATE="$(run_in_prod docker compose exec -T db psql -U "${POSTGRES_USER:-bodega}" -d "${POSTGRES_DB:-bodega}" -tAc "SELECT CASE WHEN EXISTS (SELECT 1 FROM system_settings WHERE key = 'dte.encryption_mode' AND value = 'encrypted_only') THEN 'encrypted_only' ELSE 'compat' END" 2>/dev/null | tr -d '[:space:]' || true)"
if [ "$CUTOVER_STATE" != "compat" ] && [ "$CUTOVER_STATE" != "encrypted_only" ]; then
  CUTOVER_STATE="unknown"
fi
echo "==> DTE cutover state: $CUTOVER_STATE"

ROLLBACK_ARMED=1
run_timed "Recreating app container" run_in_prod docker compose up -d --no-deps --force-recreate app

check_app_health() {
  sleep 5
  # El 3000 está publicado sólo en el loopback de prod, así que el curl corre allá.
  prod_run curl -sf http://127.0.0.1:3000/api/health
}

run_timed "Health check" check_app_health
run_timed "Recreating cron container" run_in_prod docker compose up -d --no-deps --force-recreate cron

check_cron_health() {
  app_containers=$(run_in_prod docker compose ps -q app | tr -d '\r')
  cron_containers=$(run_in_prod docker compose ps -q cron | tr -d '\r')
  test -n "$app_containers"
  test -n "$cron_containers"
  # Todas las réplicas app deben llevar el mismo release compatible con sobres
  # antes de que un operador pueda ejecutar el corte. Cron queda deliberadamente
  # singleton: escalarlo duplicaría las sincronizaciones programadas.
  for app_container in $app_containers; do
    test "$(prod_run docker inspect --format '{{.Config.Image}}' "$app_container" | tr -d '\r')" = "$IMAGE"
  done
  set -- $cron_containers
  test "$#" -eq 1
  cron_container="$1"
  test "$(prod_run docker inspect --format '{{.Config.Image}}' "$cron_container" | tr -d '\r')" = "$IMAGE"
  for attempt in $(seq 1 12); do
    if [ "$(prod_run docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cron_container" | tr -d '\r')" = "healthy" ]; then
      break
    fi
    sleep 5
  done
  test "$(prod_run docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cron_container" | tr -d '\r')" = "healthy"
}

run_timed "Cron health check" check_cron_health
# Read-only protected evaluator smoke. It does not call either sync route and
# keeps CRON_SECRET inside the app container process.
run_protected_cron_smoke() {
  run_in_prod docker compose exec -T app node -e '
    const secret = process.env.CRON_SECRET
    if (!secret) process.exit(1)
    fetch("http://127.0.0.1:3000/api/cron/dte-sync-health", { headers: { Authorization: `Bearer ${secret}` } })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok || !body || typeof body.code !== "string") process.exit(1)
      })
      .catch(() => process.exit(1))
  '
}
run_timed "Protected cron smoke" run_protected_cron_smoke
ROLLBACK_ARMED=0
trap - EXIT
echo
echo "Deploy complete: app and cron use $IMAGE."

echo
echo "==> Verificando Base preventiva 2026..."

# Check if the PDTP base 2026 template is published by querying the DB.
# If not, print instructions for the one-time bootstrap.
BASE_CHECK=$( (run_in_prod docker compose exec -T db psql -U bodega -d bodega -tAc \
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

echo "==> Total deploy time: $(format_duration "$((SECONDS - DEPLOY_STARTED_SECONDS))")"
