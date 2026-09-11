#!/usr/bin/env bash
set -euo pipefail

# ── Production deploy (build local + ship over SSH) ─────────────────────────
# Usage:  npm run deploy:prod
#         PROD_SSH=usuario@host npm run deploy:prod          # override target
#         PROD_DIR=/srv/plataforma npm run deploy:prod       # override path
#         PROD_PUBLIC_URL=https://... npm run deploy:prod     # override edge URL
#
# Producción vive en OTRA máquina desde 2026-08-28 (antes compartía el daemon
# Docker con este checkout). La imagen se sigue construyendo acá, sobre `main`,
# pero ahora viaja por SSH y todo lo que toca prod pasa por `run_in_prod`.
# El servidor sólo se alcanza por el túnel de Cloudflare: el puerto 22 no está
# publicado, así que se entra con `cloudflared access ssh` como ProxyCommand.
# El .env de prod NO viaja en el repo ni lo escribe este script: es estado del
# servidor. Por eso el compose sincronizado se contrasta contra él (variables
# exigidas y variables nuevas) y el nombre de imagen se resuelve ALLÁ.
# Steps: sync compose -> contrastar .env -> resolver nombre de imagen -> tag
# current image as rollback -> pg_dump -> build -> ship image -> preflight
# conciliación -> preflight combustible -> migrate -> migración documental SST
# a Cloudreve -> normalize EPP -> estado de solicitudes -> catálogo de tallas
# -> conciliar variantes
# duplicadas por talla -> completar el rango de tallas de ropa EPP ->
# backfill conciliación (si hace falta) ->
# backfill referencias OC en DTE (si hace falta) -> backfill lecturas de medidor
# -> catálogo de reglas de anomalía -> sync-rbac -> decisiones de catálogo PDTP
# -> dato de cursos/planes/campañas -> catálogo de inspecciones -> recreate app
# then cron containers ->
# authenticated smoke check -> prune -> smoke público por el túnel.
# ─────────────────────────────────────────────────────────────────────────────

PROD_SSH="${PROD_SSH:-allopze@ssh.portalchome.cl}"
PROD_DIR="${PROD_DIR:-/srv/plataforma}"
PROD_SSH_KEY="${PROD_SSH_KEY:-$HOME/.ssh/id_ed25519_migracion}"
# Si el operador fija IMAGE a mano, manda; si no, el nombre real lo dicta el
# Compose de prod (ver "Resolviendo el nombre de imagen" más abajo).
IMAGE_EXPLICIT="${IMAGE:+1}"
IMAGE="${IMAGE:-ghcr.io/allopze/bodega:latest}"
PREV_IMAGE="${IMAGE%:*}:prev"
BUILDER="${BUILDER:-chome-prod}"
# Lo único que se comprueba desde fuera del servidor: que el túnel publique
# esta release. Nada de lo demás pasa por el borde de Cloudflare.
PROD_PUBLIC_URL="${PROD_PUBLIC_URL:-https://plataforma.portalchome.cl}"
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

# Con BatchMode el fallo de un binario que falta sale como un error de SSH sin
# relación aparente. Barato de comprobar acá, caro de diagnosticar allá.
required_local_tools=(ssh docker curl md5sum)
case " ${prod_ssh_opts[*]} " in
  *cloudflared*) required_local_tools+=(cloudflared) ;;
esac
for tool in "${required_local_tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: falta '$tool' en esta máquina; el deploy lo necesita."
    if [ "$tool" = cloudflared ]; then
      echo "       El servidor sólo se alcanza por el túnel: sin cloudflared no hay SSH."
      echo "       curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb && sudo dpkg -i /tmp/cf.deb"
    fi
    exit 1
  fi
done

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

# Una etapa de datos que simula en vez de escribir es peor que una que falla:
# imprime sus "✓ instalada", sale con 0, y el deploy sigue creyendo que sembró.
# Así estuvo `SEED_DRY_RUN=true` en el `.env` de producción desde el 21-ago,
# neutralizando `seed-inspection-templates` en 23 despliegues seguidos sin que
# nada se quejara: las 15 plantillas del catálogo nunca existieron y la
# compuerta del PDTP terminó culpando a las actividades. Cada script trae su
# propia variable, así que se comprueban todas por patrón y no con una lista
# que se quedaría corta en cuanto alguien agregue la novena.
dry_run_vars="$(prod_sh "grep -oE '^[A-Z_]*DRY_RUN=(true|1)' $(printf '%q' "$PROD_DIR")/.env 2>/dev/null | cut -d= -f1" || true)"
if [ -n "$dry_run_vars" ]; then
  echo "ERROR: el .env de producción deja etapas de datos en modo simulación:"
  echo "$dry_run_vars" | sed 's/^/       - /'
  echo "       Esas etapas dirían que sembraron sin escribir nada. Quítalas de"
  echo "       $PROD_SSH:$PROD_DIR/.env (el dry run se pasa por comando, no se fija)."
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
previous_compose=""
# El compose remoto se compara por hash: traerlo entero para un `cmp` local
# costaría una ida y vuelta más por despliegue.
remote_compose_sum="$(prod_sh "md5sum $(printf '%q' "$PROD_DIR/docker-compose.yml") 2>/dev/null | cut -d' ' -f1" | tr -d '\r')"
if [ -n "$remote_compose_sum" ] && [ "$remote_compose_sum" != "$(md5sum docker-compose.yml | cut -d' ' -f1)" ]; then
  compose_backup="$PROD_DIR/backups/docker-compose-predeploy-$(date +%F-%H%M%S).yml"
  prod_run cp "$PROD_DIR/docker-compose.yml" "$compose_backup"
  echo "    saved previous Compose definition: $compose_backup"
  # Sólo cuando el compose cambió vale la pena traerlo: con la versión anterior
  # a mano se puede distinguir "variable que prod nunca tuvo" de "variable que
  # este deploy acaba de introducir", que es la que de verdad avisa.
  previous_compose="$(mktemp)"
  # Se borra abajo tras el contraste; el trap sólo cubre las salidas por error
  # de aquí a allá (lo reemplaza `rollback_release`, que se instala después).
  trap 'rm -f "$previous_compose"' EXIT
  prod_sh "cat $(printf '%q' "$PROD_DIR/docker-compose.yml")" > "$previous_compose"
fi
prod_sh "cat > $(printf '%q' "$PROD_DIR/docker-compose.yml")" < docker-compose.yml

# Nombres de variables que el compose interpola: `${VAR}`, `${VAR:-def}`, `${VAR:?err}`.
compose_var_names() {
  grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*' "$1" | cut -c3- | sort -u
}

# Sólo las marcadas `:?`, que son las que hacen fallar a compose si faltan.
compose_required_var_names() {
  grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*:\?' "$1" | cut -c3- | sed 's/:?$//' | sort -u
}

prod_env_keys() {
  prod_sh "grep -oE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' $(printf '%q' "$PROD_DIR/.env") 2>/dev/null" \
    | tr -d '\r' | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//; s/=$//' | sort -u
}

# El valor de UNA variable del .env de prod. Sólo se usa con nombres de este
# script (POSTGRES_USER / POSTGRES_DB), nunca con entrada del operador.
prod_env_value() {
  prod_sh "grep -E '^[[:space:]]*(export[[:space:]]+)?$1=' $(printf '%q' "$PROD_DIR/.env") 2>/dev/null | tail -1" \
    | tr -d '\r' | sed -E "s/^[[:space:]]*(export[[:space:]]+)?$1=//" | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

# El .env de prod es estado del servidor: no viaja en el repo y este script no
# lo sobreescribe. Sin este contraste, un compose que empieza a leer una
# variable nueva despliega verde y la app arranca sin ella.
echo "==> Contrastando el .env de producción con el Compose recién enviado"
prod_env_keys_list="$(prod_env_keys)"
if [ -z "$prod_env_keys_list" ]; then
  echo "ERROR: $PROD_DIR/.env está vacío o no se pudo leer."
  exit 1
fi
echo "    $(printf '%s\n' "$prod_env_keys_list" | wc -l | tr -d ' ') variables definidas en $PROD_DIR/.env"

missing_required="$(comm -23 <(compose_required_var_names docker-compose.yml) <(printf '%s\n' "$prod_env_keys_list"))"
if [ -n "$missing_required" ]; then
  echo "ERROR: el Compose exige estas variables (\${VAR:?}) y no están en $PROD_DIR/.env:"
  printf '       %s\n' $missing_required
  echo "       Agrégalas allá antes de desplegar; compose fallaría a mitad de camino."
  exit 1
fi

if [ -n "$previous_compose" ]; then
  new_vars="$(comm -23 <(compose_var_names docker-compose.yml) <(compose_var_names "$previous_compose"))"
  if [ -n "$new_vars" ]; then
    missing_new="$(comm -23 <(printf '%s\n' "$new_vars") <(printf '%s\n' "$prod_env_keys_list"))"
    if [ -n "$missing_new" ]; then
      echo "    AVISO: variables que este deploy empieza a leer y prod NO define (se usará el default del compose):"
      printf '           %s\n' $missing_new
    fi
  fi
  rm -f "$previous_compose"
  previous_compose=""
  trap - EXIT
fi

# Antes se expandían `${POSTGRES_USER:-bodega}` en ESTA máquina: si el operador
# tenía esas variables exportadas para desarrollo, los conteos y la sonda de
# `CUTOVER_STATE` corrían con credenciales equivocadas contra prod (y un
# CUTOVER_STATE=unknown bloquea el rollback automático). Se leen de allá.
PROD_DB_USER="$(prod_env_value POSTGRES_USER)"
PROD_DB_NAME="$(prod_env_value POSTGRES_DB)"
PROD_DB_USER="${PROD_DB_USER:-bodega}"
PROD_DB_NAME="${PROD_DB_NAME:-bodega}"
echo "    psql/pg_dump usarán $PROD_DB_USER@$PROD_DB_NAME"

# El compose resuelve `ghcr.io/${GITHUB_REPOSITORY:-chome/bodega}:${IMAGE_TAG:-latest}`
# con el .env de allá, no con el de acá. Si se construye y se carga un nombre
# distinto del que compose va a levantar, `up` no encuentra la imagen y, como el
# servicio `app` trae su propio `build:`, intenta compilar en $PROD_DIR — que no
# tiene código. Resolver el nombre con el mismo contrato y verificar que aparece
# exactamente entre las imagenes configuradas para `app` cierra ese hueco.
resolve_prod_image() {
  local prod_repository prod_image_tag configured_images

  prod_repository="$(prod_env_value GITHUB_REPOSITORY)"
  prod_image_tag="$(prod_env_value IMAGE_TAG)"
  prod_image="ghcr.io/${prod_repository:-chome/bodega}:${prod_image_tag:-latest}"

  # `docker compose config --images app` incluye tambien las dependencias de
  # app. Su orden no es estable entre versiones de Compose: tomar la primera
  # puede seleccionar `postgres:16-alpine` y reemplazar la base por la imagen
  # de Next.js. Solo aceptamos la coincidencia exacta con el contrato anterior.
  configured_images="$(run_in_prod docker compose config --images app 2>/dev/null | tr -d '\r')"
  if ! printf '%s\n' "$configured_images" | grep -Fxq "$prod_image"; then
    echo "ERROR: el Compose de prod no configura $prod_image para el servicio app."
    echo "       Imagenes que Compose asocia a app y sus dependencias:"
    printf '       %s\n' "$configured_images"
    return 1
  fi
}

echo "==> Resolviendo el nombre de imagen que usará el Compose de producción"
resolve_prod_image
if [ "$prod_image" != "$IMAGE" ]; then
  if [ -n "$IMAGE_EXPLICIT" ]; then
    echo "ERROR: IMAGE=$IMAGE pero el Compose de prod levanta $prod_image."
    echo "       Ajusta GITHUB_REPOSITORY/IMAGE_TAG en $PROD_DIR/.env o quita el override de IMAGE."
    exit 1
  fi
  echo "    el Compose de prod levanta $prod_image; se construye y envía con ese nombre"
  IMAGE="$prod_image"
  PREV_IMAGE="${IMAGE%:*}:prev"
fi
echo "    imagen: $IMAGE (rollback: $PREV_IMAGE)"

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
  prod_sh "cd $(printf '%q' "$PROD_DIR") && docker compose exec -T db pg_dump -U $(printf '%q' "$PROD_DB_USER") -Fc $(printf '%q' "$PROD_DB_NAME") > $(printf '%q' "$dump_file")"
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

# La migración SST es idempotente y conserva el origen local; debe ejecutarse
# después de que la base ya tenga el esquema y antes de levantar la nueva app.
run_timed "Migrando documentos SST a Cloudreve" run_in_prod docker compose run --rm migrate-sst-to-cloudreve

run_timed "Normalizando SKUs de EPP y servicios" run_in_prod docker compose run --rm normalize-epp-skus

# Recalcula el estado derivado de las solicitudes cuya regla de cierre cambió
# después de que sus ítems llegaran a estado terminal. Sin esto quedan con el
# estado que calculó la regla vieja, porque el rollup solo se dispara en una
# transición de ítem y a esas solicitudes ya no les queda ninguna. Idempotente:
# sin deriva no escribe.
run_timed "Reconciliando el estado de las solicitudes" run_in_prod docker compose run --rm reconcile-request-status

# Los tres pasos de tallas van en este orden y no en otro:
#
#   1. `size_catalog` al día: de esta tabla sale la familia `ropa` que el paso 3
#      exige, así que sin esto el backfill no encuentra ninguna familia.
#   2. Conciliar duplicados: deja una sola variante por talla antes de que el
#      paso 3 mire qué tallas existen. Al revés, el backfill contaría una talla
#      duplicada como presente y el duplicado seguiría vivo.
#   3. Completar el rango de ropa.
run_timed "Sincronizando el catálogo de tallas" run_in_prod docker compose run --rm seed-size-catalog

# Da de baja las variantes que son la misma talla física escrita de dos formas
# (`N41` junto a `T41`, `L` junto a `T/L`) o duplicadas de plano. Sólo toca las
# que no tienen stock ni historial; las que participaron de una operación las
# informa y las salta. Se desactiva, no se borra: revertir es un UPDATE, y cada
# baja queda en el audit log con la variante que la absorbió.
run_timed "Conciliando variantes duplicadas por talla" run_in_prod docker compose run --rm reconcile-epp-duplicate-sizes

# Completa S/M/L/XL/2XL/3XL —el rango que el negocio realmente compra— en toda
# familia EPP que declare `size_family = 'ropa'`. Va después de normalizar SKUs
# para que las tallas nuevas nazcan con la numeración secuencial vigente.
# Idempotente: familias completas o de otra familia de tallas no se tocan.
run_timed "Completando el rango de tallas de ropa EPP" run_in_prod docker compose run --rm backfill-epp-clothing-sizes

# El backfill recalcula tanto OC nunca proyectadas como huellas de una versión
# anterior. La versión 2 introduce estados parciales, así que conservar una
# huella v1 dejaría la pantalla y la cola con semántica antigua.
echo "==> Proyección de conciliación OC-factura"
pending_reconciliation="$(run_in_prod docker compose exec -T db psql -U "$PROD_DB_USER" -d "$PROD_DB_NAME" -tAc "SELECT COUNT(*) FROM purchase_orders po WHERE (po.invoice_reconciliation_fingerprint IS NULL OR po.invoice_reconciliation_fingerprint NOT LIKE 'v2:%') AND EXISTS (SELECT 1 FROM purchase_order_invoices poi WHERE poi.purchase_order_id = po.id)" 2>/dev/null | tr -d '[:space:]' || true)"
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
pending_dte_refs="$(run_in_prod docker compose exec -T db psql -U "$PROD_DB_USER" -d "$PROD_DB_NAME" -tAc "SELECT COUNT(*) FROM dte_documents WHERE referenced_order_codes IS NULL AND xml_path IS NOT NULL" 2>/dev/null | tr -d '[:space:]' || true)"
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

# Sin conteo previo: no hay forma barata de saber cuántas filas guardaron un
# valor del normalizador viejo sin releer sus XML, que es justo lo que hace el
# script. Es idempotente y sólo escribe cuando el valor cambia, así que sobre
# una base al día no toca ninguna fila.
run_timed "Relectura de referencias a OC con el normalizador actual" run_in_prod docker compose run --rm reparse-dte-order-refs

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

# Las decisiones de la jefatura de prevención sobre el programa 2026 —retiros,
# corresponsables, textos y qué actividades se miden por cobertura— son datos
# del programa, no del código. Estuvieron escritas y sin aplicar entre agosto y
# septiembre de 2026 justamente porque dependían de que alguien se acordara de
# correr el script: acá dejan de depender de eso.
#
# Va antes del catálogo de inspecciones porque decide qué actividades siguen
# vivas, y antes del swap porque la app debe levantar con el programa ya
# depurado. No aborta el deploy si el programa todavía no existe o ya está
# firmado (PDTP_DECISIONS_DEPLOY_MODE); sí lo aborta si falla por otra razón.
run_timed "Aplicando decisiones de catálogo del PDTP" run_in_prod docker compose run --rm apply-pdtp-catalog-decisions

# Qué faenas operan el programa y qué actividades no les aplican dentro de las
# que sí lo operan. Sin esto `pdtp_program_worksites` queda vacío y la regla
# del motor es "sin membresía declarada, todas las faenas activas": las 81
# actividades quedarían exigibles también en Oficina Central. Va después de las
# decisiones de catálogo (que deciden qué actividades siguen vivas, para no
# intentar excluir una ya retirada) y antes del diagnóstico de cableado, que
# debe reportar sobre la membresía ya declarada. No aborta el deploy si el
# programa todavía no existe, no hay administrador, o ya está firmado
# (PDTP_WORKSITE_SCOPE_DEPLOY_MODE).
run_timed "Declarando el alcance por faena del PDTP" run_in_prod docker compose run --rm apply-pdtp-worksite-scope

# Después de las decisiones de catálogo: primero se decide qué actividades viven,
# luego se declara qué registro acredita cada una.
# Antes que el dato del PDTP: los tipos documentales son el catálogo donde la
# N°43 y la N°36 declaran su número, así que Documentación SST es prerrequisito
# y no al revés.
run_timed "Sembrando el catálogo de Documentación SST" run_in_prod docker compose run --rm apply-sst-taxonomy

# El plan de emergencia de cada faena, en borrador. Es lo que permite que la
# N°84 declare su número y, con eso, que el programa anual pueda activarse.
# Aprobarlo NO se automatiza: el servicio exige que quien aprueba no sea quien
# creó, y aprobar es el acto que acredita la N°83.
run_timed "Sembrando el plan de emergencia de cada faena" run_in_prod docker compose run --rm seed-emergency-plans

run_timed "Declarando el dato de cursos, planes y campañas del PDTP" run_in_prod docker compose run --rm apply-pdtp-program-data

# Después de los retiros: clasifica sólo lo que sigue activo, así que correrlo
# antes dejaría clasificada una actividad que el paso anterior acaba de retirar.
run_timed "Clasificando las actividades del PDTP por mecanismo" run_in_prod docker compose run --rm apply-pdtp-mechanisms

# Después de los retiros y de la clasificación: sin SLA ni evidencia mínima en
# las actividades a demanda, el programa no se puede ni enviar a revisión
# (`pdtpSubmitReviewBlockers`). No aborta el deploy si el programa todavía no
# existe o ya está firmado (PDTP_DEMAND_SLAS_DEPLOY_MODE).
run_timed "Declarando el SLA de las actividades a demanda del PDTP" run_in_prod docker compose run --rm apply-pdtp-demand-slas

# Idempotente y antes del swap: si falla, el deploy aborta con la app anterior
# todavía en pie. Va acá y no después porque la app debe levantar con el
# catálogo ya cableado — una plantilla sin `pdtpActivityNumbers` ejecuta la
# inspección sin acreditar nada en el programa anual.
run_timed "Instalando el catálogo de inspecciones cableado al PDTP" run_in_prod docker compose run --rm seed-inspection-templates

# Informe, no compuerta: deja en el log del deploy qué actividades quedaron sin
# instrumento vigente y qué plantillas vigentes se están ejecutando sin declarar
# ninguna. Aprobar un instrumento es un acto de una persona y no se automatiza;
# lo que sí se automatiza es que nadie pueda decir que no lo sabía.
run_timed "Diagnóstico del cableado de acreditación del PDTP" run_in_prod docker compose run --rm preflight-pdtp-wiring

# Al final de los pasos del PDTP: reprocesa los eventos de cumplimiento que
# quedaron pending/error en pdtp_fulfillment_events — un hecho ocurrido con el
# programa en borrador o un mapeo que se acaba de corregir en los pasos
# anteriores. Idempotente; nunca aborta el deploy por su cuenta.
run_timed "Reconciliando eventos de cumplimiento pendientes del PDTP" run_in_prod docker compose run --rm reconcile-pdtp-fulfillment-events

# The durable database marker, not merely a host env var, determines whether
# the immediately previous image is safe. A failed probe is deliberately
# conservative: after the app has been replaced, an operator must choose a
# known encryption-compatible rollback floor instead of reviving a legacy tag.
CUTOVER_STATE="$(run_in_prod docker compose exec -T db psql -U "$PROD_DB_USER" -d "$PROD_DB_NAME" -tAc "SELECT CASE WHEN EXISTS (SELECT 1 FROM system_settings WHERE key = 'dte.encryption_mode' AND value = 'encrypted_only') THEN 'encrypted_only' ELSE 'compat' END" 2>/dev/null | tr -d '[:space:]' || true)"
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

# Cada deploy carga una imagen completa en el servidor y deja la anterior
# tagueada como `:prev`. Ya no hay un daemon compartido con este checkout que
# recicle capas, así que sin esto /var/lib/docker crece ~700 MB por despliegue.
# `prune` sin `-a` sólo borra imágenes sin tag: `:latest` y `:prev` quedan.
echo "==> Limpiando capas huérfanas en el servidor"
prod_run docker image prune -f | tail -1

# Lo único que se comprueba desde fuera. Todo el smoke anterior corre DENTRO del
# servidor, así que no distingue "la release está sana" de "el túnel publica esta
# release": con cloudflared caído en prod —o todavía vivo en el box viejo— el
# deploy pasaba verde igual.
echo "==> Smoke público a través del túnel ($PROD_PUBLIC_URL)"
public_smoke_ok=0
for attempt in $(seq 1 6); do
  if curl -sf --max-time 20 "$PROD_PUBLIC_URL/api/health" >/dev/null; then
    public_smoke_ok=1
    break
  fi
  sleep 5
done
if [ "$public_smoke_ok" -ne 1 ]; then
  echo
  echo "ERROR: la release está arriba en el servidor (health y cron pasaron allá),"
  echo "       pero $PROD_PUBLIC_URL/api/health no responde 200 desde fuera."
  echo "       Eso apunta al borde, no a la aplicación. Revisa:"
  echo "         systemctl status cloudflared   # en el servidor de producción"
  echo "         systemctl status cloudflared   # y que NO esté vivo en el box viejo"
  echo "       No se hace rollback: la imagen nueva ya se verificó del lado del servidor."
  exit 1
fi
echo "    200 OK desde fuera"

echo
echo "==> Verificando Base preventiva 2026..."

# Check if the PDTP base 2026 template is published by querying the DB.
# If not, print instructions for the one-time bootstrap.
BASE_CHECK=$( (run_in_prod docker compose exec -T db psql -U "$PROD_DB_USER" -d "$PROD_DB_NAME" -tAc \
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
