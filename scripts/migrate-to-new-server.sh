#!/usr/bin/env bash
set -euo pipefail

# ── Migración de producción a un servidor nuevo ──────────────────────────────
#
#   TARGET_SSH=usuario@ssh.portalchome.cl ./scripts/migrate-to-new-server.sh
#
# Mueve la plataforma entera (imagen + .env + compose + base + adjuntos) desde
# este box al destino. NO toca el túnel: ese corte va aparte porque exige sudo
# en ambas máquinas (ver la sección CORTE que imprime al final).
#
# Pasos: check → image → config → freeze → data → start.
# Cada paso es idempotente y se puede correr suelto:  --only data
# `--from data` retoma desde ahí.
#
# La ventana de indisponibilidad empieza en `freeze` y termina en `start`.
# Con ~110 MB de datos son minutos; la imagen (~700 MB comprimida) se manda
# ANTES de congelar, a propósito.
# ─────────────────────────────────────────────────────────────────────────────

TARGET_SSH="${TARGET_SSH:?falta TARGET_SSH (ej: usuario@ssh.portalchome.cl)}"
TARGET_DIR="${TARGET_DIR:-/srv/plataforma}"
SRC_DIR="${SRC_DIR:-/server/plataforma}"
IMAGE="${IMAGE:-ghcr.io/allopze/bodega:latest}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_migracion}"

# El destino sólo se alcanza por el túnel de Cloudflare (puerto 22 no está
# publicado). Si TARGET_SSH apunta a una IP de la LAN, esto sobra y se apaga
# solo: el ProxyCommand únicamente se arma para nombres *.portalchome.cl.
target_host="${TARGET_SSH#*@}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 -i "$SSH_KEY")
case "$target_host" in
  *.portalchome.cl) SSH_OPTS+=(-o "ProxyCommand=cloudflared access ssh --hostname %h") ;;
esac

# El nombre del volumen lo fabrica compose con el basename del directorio.
# Si el destino no se llama igual, `docker compose up` crearía volúmenes
# vacíos al lado de los que acabamos de restaurar.
project="$(basename "$SRC_DIR")"
if [ "$(basename "$TARGET_DIR")" != "$project" ]; then
  echo "ERROR: TARGET_DIR debe terminar en /$project (compose deriva de ahí los nombres de volumen)"
  exit 1
fi
VOL_STORAGE="${project}_bodega-storage"

STEPS=(check image config freeze data start)
ONLY=""; FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --from) FROM="$2"; shift 2 ;;
    *) echo "ERROR: argumento desconocido: $1"; exit 1 ;;
  esac
done

should_run() {
  local step="$1"
  if [ -n "$ONLY" ]; then [ "$step" = "$ONLY" ]; return; fi
  if [ -n "$FROM" ]; then
    local seen=0
    for s in "${STEPS[@]}"; do
      [ "$s" = "$FROM" ] && seen=1
      [ "$s" = "$step" ] && { [ "$seen" = 1 ]; return; }
    done
    return 1
  fi
  return 0
}

remote() { ssh "${SSH_OPTS[@]}" "$TARGET_SSH" "$@"; }
src()    { (cd "$SRC_DIR" && "$@"); }
banner() { echo; echo "==> $1"; }

# ── check ────────────────────────────────────────────────────────────────────
if should_run check; then
  banner "Verificando origen y destino"
  src docker compose ps --format '{{.Service}} {{.State}}' | sed 's/^/    origen: /'
  docker image inspect "$IMAGE" >/dev/null || { echo "ERROR: falta la imagen $IMAGE en el origen"; exit 1; }
  [ -f "$SRC_DIR/.env" ] || { echo "ERROR: falta $SRC_DIR/.env"; exit 1; }

  remote 'set -e
    echo "    destino: $(hostname) — $(. /etc/os-release; echo "$PRETTY_NAME")"
    command -v docker >/dev/null || { echo "ERROR: docker no está instalado en el destino"; exit 1; }
    docker compose version >/dev/null || { echo "ERROR: falta el plugin docker compose en el destino"; exit 1; }
    docker info >/dev/null 2>&1 || { echo "ERROR: el usuario no puede hablar con el daemon docker (¿falta el grupo docker?)"; exit 1; }
    echo "    docker: $(docker --version)"
    echo "    espacio libre: $(df -h /var/lib/docker 2>/dev/null | tail -1 | awk "{print \$4}") en /var/lib/docker"
    if ss -tln 2>/dev/null | grep -q "127.0.0.1:3000 "; then
      echo "    AVISO: ya hay algo escuchando en 127.0.0.1:3000 en el destino"
    fi'
  # Antes de gastar la transferencia de la imagen: si /srv no es escribible
  # para este usuario, el paso `config` falla igual pero 700 MB después.
  remote "mkdir -p '$TARGET_DIR/backups' && test -w '$TARGET_DIR'" || {
    echo "ERROR: no se puede crear/escribir $TARGET_DIR en el destino."
    echo "       Crea el directorio con permisos para el usuario, p.ej.:"
    echo "         sudo install -d -o \$(whoami) -g \$(whoami) $TARGET_DIR"
    exit 1
  }
  echo "    OK"
fi

# ── image ────────────────────────────────────────────────────────────────────
# Antes de congelar: es lo pesado y no depende del estado de la base.
if should_run image; then
  banner "Enviando la imagen $IMAGE (~$(docker image inspect "$IMAGE" --format '{{.Size}}' | awk '{printf "%.1f GB sin comprimir", $1/1024/1024/1024}'))"
  # Se comparan las capas, no `.Id`: con el almacén de imágenes de containerd
  # (Docker 29+) el ID se recalcula al cargar, así que una imagen idéntica
  # llega con otro ID y comparar por ID reenviaría ~700 MB en cada corrida.
  fingerprint="{{range .RootFS.Layers}}{{.}}{{\"\n\"}}{{end}}"
  local_layers="$(docker image inspect "$IMAGE" --format "$fingerprint" | md5sum)"
  remote_layers="$(remote "docker image inspect '$IMAGE' --format '$fingerprint' 2>/dev/null | md5sum" | tr -d '\r')"
  if [ "$local_layers" = "$remote_layers" ]; then
    echo "    el destino ya tiene la misma imagen; omitido"
  else
    docker save "$IMAGE" | gzip -1 | remote 'gunzip | docker load'
  fi
fi

# ── config ───────────────────────────────────────────────────────────────────
if should_run config; then
  banner "Enviando docker-compose.yml y .env"
  remote "mkdir -p '$TARGET_DIR/backups'"
  # .env va con umask cerrado: lleva AUTH_SECRET, el keyring DTE y las
  # credenciales de Copec/Chipax/portal SII en claro.
  remote "umask 077 && cat > '$TARGET_DIR/.env'" < "$SRC_DIR/.env"
  remote "cat > '$TARGET_DIR/docker-compose.yml'" < "$SRC_DIR/docker-compose.yml"
  remote "chmod 600 '$TARGET_DIR/.env'; ls -l '$TARGET_DIR/.env' '$TARGET_DIR/docker-compose.yml'"
fi

# ── freeze ───────────────────────────────────────────────────────────────────
# Empieza la ventana. Se detienen app y cron pero NO db: el pg_dump del paso
# siguiente la necesita en pie, y con los dos consumidores abajo ya nadie
# escribe.
if should_run freeze; then
  banner "Congelando escrituras en el origen (empieza la indisponibilidad)"
  src docker compose stop app cron
  src docker compose ps --format '{{.Service}} {{.State}}' | sed 's/^/    /'
fi

# ── data ─────────────────────────────────────────────────────────────────────
if should_run data; then
  banner "Copia de seguridad previa en el origen"
  pre_dump="$SRC_DIR/backups/premigracion-$(date +%F-%H%M).dump"
  src docker compose exec -T db pg_dump -U bodega -Fc bodega > "$pre_dump"
  echo "    $pre_dump ($(du -h "$pre_dump" | cut -f1))"

  banner "Levantando postgres en el destino"
  remote "cd '$TARGET_DIR' && docker compose up -d db"
  remote "cd '$TARGET_DIR' && for i in \$(seq 1 30); do
      [ \"\$(docker compose ps db --format '{{.Health}}')\" = healthy ] && exit 0
      sleep 5
    done; echo 'ERROR: postgres no llegó a healthy en el destino'; exit 1"

  banner "Restaurando la base"
  # --clean --if-exists deja el paso repetible: una segunda corrida no apila
  # sobre lo ya restaurado. Los avisos de "does not exist" en la primera son
  # esperados.
  gzip -c "$pre_dump" | remote "cd '$TARGET_DIR' && gunzip | docker compose exec -T db pg_restore -U bodega -d bodega --clean --if-exists --no-owner" || \
    echo "    (pg_restore terminó con avisos; se verifican las tablas abajo)"

  banner "Restaurando los adjuntos ($VOL_STORAGE)"
  docker run --rm -v "$VOL_STORAGE":/v alpine tar -C /v -czf - . \
    | remote "docker volume create '$VOL_STORAGE' >/dev/null && docker run --rm -i -v '$VOL_STORAGE':/v alpine tar -C /v -xzf -"

  banner "Contraste origen ↔ destino"
  # Esto no es decorativo: es lo único que atrapa un pg_restore que se rompió
  # a medias, porque sus avisos legítimos ("does not exist, skipping" sobre la
  # base recién creada) obligan a tolerar su código de salida.
  count_sql="SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') || ' tablas, ' || (SELECT count(*) FROM users) || ' usuarios, ' || (SELECT count(*) FROM dte_documents) || ' DTE, ' || (SELECT count(*) FROM inventory_movements) || ' movimientos'"
  src_counts="$(src docker compose exec -T db psql -U bodega -d bodega -tAc "$count_sql" | tr -d '\r')"
  dst_counts="$(remote "cd '$TARGET_DIR' && docker compose exec -T db psql -U bodega -d bodega -tAc \"$count_sql\"" | tr -d '\r')"
  src_files="$(docker run --rm -v "$VOL_STORAGE":/v alpine sh -c 'find /v -type f | wc -l' | tr -d '\r')"
  dst_files="$(remote "docker run --rm -v '$VOL_STORAGE':/v alpine sh -c 'find /v -type f | wc -l'" | tr -d '\r')"
  echo "    base     origen $src_counts"
  echo "    base     destino $dst_counts"
  echo "    adjuntos origen $src_files archivos / destino $dst_files archivos"
  if [ "$src_counts" != "$dst_counts" ] || [ "$src_files" != "$dst_files" ]; then
    echo
    echo "ERROR: el destino no coincide con el origen. NO cortes el túnel."
    echo "       El origen sigue intacto: 'cd $SRC_DIR && docker compose up -d app cron' lo revive."
    echo "       Revisa el log de pg_restore y reintenta con: --only data"
    exit 1
  fi
  echo "    coinciden"
fi

# ── start ────────────────────────────────────────────────────────────────────
if should_run start; then
  banner "Migraciones y RBAC en el destino (deberían ser no-op: misma release)"
  remote "cd '$TARGET_DIR' && docker compose run --rm migrate"
  remote "cd '$TARGET_DIR' && docker compose run --rm sync-rbac"

  banner "Levantando app y cron en el destino"
  remote "cd '$TARGET_DIR' && docker compose up -d app cron"
  # Siempre responde "degraded" por los bugs del health check en Alpine
  # (chequea /data en vez de /data/storage, y df --output que busybox no tiene).
  # Lo que importa es el 200; por eso se informa pero no aborta.
  remote "sleep 10; curl -sf http://127.0.0.1:3000/api/health | head -c 400; echo" \
    || echo "    AVISO: /api/health no devolvió 200; mira 'docker compose logs app' en el destino"
  remote "cd '$TARGET_DIR' && docker compose ps --format '{{.Service}} {{.State}} {{.Health}}'"
fi

cat <<EOF

────────────────────────────────────────────────────────────────────────────
Datos y aplicación ya están en el destino. Falta el CORTE del túnel, que
exige sudo en las dos máquinas y por eso no va en este script:

  1) En ESTE box, soltar el dominio:
       sudo systemctl disable --now cloudflared

  2) En el DESTINO, tomar el mismo túnel (mismo token ⇒ plataforma.portalchome.cl
     sigue resolviendo igual, no hay que tocar el panel de Cloudflare):
       sudo cp /etc/systemd/system/cloudflared.service  # copiar desde este box
       sudo systemctl daemon-reload
       sudo systemctl enable --now cloudflared

     El token está en el ExecStart de $(hostname):/etc/systemd/system/cloudflared.service
     Instalar cloudflared antes si falta:
       curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb && sudo dpkg -i /tmp/cf.deb

  3) Comprobar desde fuera:
       curl -sI https://plataforma.portalchome.cl | head -3

Los dos pasos deben ir en ese orden: si cloudflared corre en ambos a la vez,
Cloudflare reparte el tráfico entre las dos copias y quedan escrituras
partidas entre dos bases.

VUELTA ATRÁS (mientras el origen siga intacto):
  sudo systemctl disable --now cloudflared   # en el destino
  cd $SRC_DIR && docker compose up -d app cron
  sudo systemctl enable --now cloudflared    # en este box
────────────────────────────────────────────────────────────────────────────
EOF
