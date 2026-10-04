#!/usr/bin/env bash
set -euo pipefail
# ── Importar un MIPER (RE-04) en PRODUCCIÓN ──────────────────────────────────
# Corre scripts/importar-miper-re04.ts desde este checkout contra la base de
# producción. El servidor no tiene el código (sólo docker-compose.yml, .env y
# respaldos: la imagen se construye acá, ver scripts/deploy-prod.sh), así que el
# script no puede correr allá: se abre un túnel SSH a la base y corre acá.
#
#   scripts/importar-miper-prod.sh --archivo "<ruta.xlsx>" --faena "<faena>" [--como <correo>] [--cargar]
#
# Los argumentos son los de importar-miper-re04.ts. Sin --cargar sólo informa.
# Las credenciales se leen del .env del servidor y nunca se imprimen.
#
# Cuidado: el código que corre es el de ESTE checkout. Su esquema tiene que ser
# el de producción (mismas migraciones); el script se niega si no lo es.
PROD_SSH="${PROD_SSH:-allopze@ssh.portalchome.cl}"
PROD_DIR="${PROD_DIR:-/srv/plataforma}"
PROD_SSH_KEY="${PROD_SSH_KEY:-$HOME/.ssh/id_ed25519_migracion}"
LOCAL_PORT="${MIPER_PROD_PORT:-15433}"
SSH_OPTS=(-i "$PROD_SSH_KEY" -o "ProxyCommand=cloudflared access ssh --hostname %h" -o BatchMode=yes -o ConnectTimeout=30)

cd "$(dirname "$0")/.."
prod_sh() { ssh "${SSH_OPTS[@]}" "$PROD_SSH" "cd $(printf '%q' "$PROD_DIR") && $1"; }

# Usuario, contraseña y base, una por línea; quedan sólo en variables de este proceso.
{ read -r PGU; read -r PGP; read -r PGD; } < <(prod_sh 'set -a; . ./.env >/dev/null 2>&1; set +a; printf "%s\n%s\n%s\n" "${POSTGRES_USER:-bodega}" "$POSTGRES_PASSWORD" "${POSTGRES_DB:-bodega}"')
[ -n "$PGP" ] || { echo "No se pudo leer la contraseña de la base desde $PROD_DIR/.env." >&2; exit 1; }
DB_IP="$(prod_sh 'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}" "$(docker compose ps -q db)"' | awk '{print $1}')"
[ -n "$DB_IP" ] || { echo "No se encontró el contenedor de la base en producción." >&2; exit 1; }

ssh "${SSH_OPTS[@]}" -o ExitOnForwardFailure=yes -N -L "127.0.0.1:$LOCAL_PORT:$DB_IP:5432" "$PROD_SSH" &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  (exec 3<>"/dev/tcp/127.0.0.1/$LOCAL_PORT") 2>/dev/null && break
  sleep 1
done

DATABASE_URL="$(PGU="$PGU" PGP="$PGP" PGD="$PGD" PORT="$LOCAL_PORT" node -e 'const e = encodeURIComponent; const v = process.env; process.stdout.write(`postgres://${e(v.PGU)}:${e(v.PGP)}@127.0.0.1:${v.PORT}/${e(v.PGD)}`)')"
export DATABASE_URL
unset PGP

# Mismo esquema o nada: el código de este checkout escribe en producción.
LOCAL_MIGRATIONS="$(node -e 'console.log(require("./db/migrations/meta/_journal.json").entries.length)')"
PROD_MIGRATIONS="$(node -e '
  const postgres = require("postgres")
  const sql = postgres(process.env.DATABASE_URL, { max: 1 })
  sql`select count(*)::int as n from drizzle.__drizzle_migrations`.then((r) => { console.log(r[0].n); return sql.end() })
')"
if [ "$LOCAL_MIGRATIONS" != "$PROD_MIGRATIONS" ]; then
  echo "Este checkout tiene $LOCAL_MIGRATIONS migraciones y producción $PROD_MIGRATIONS: el esquema no es el mismo. Despliega o cambia de checkout." >&2
  exit 1
fi

echo "Producción ($PROD_MIGRATIONS migraciones, igual que este checkout)."
npx tsx scripts/importar-miper-re04.ts "$@"
