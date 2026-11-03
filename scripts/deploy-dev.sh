#!/usr/bin/env bash
set -euo pipefail

# ── Deploy al entorno de pruebas (misma máquina que producción) ──────────────
# Usage:  npm run deploy:dev
#         DEV_SSH=usuario@host npm run deploy:dev
#         DEV_DIR=/srv/plataforma-dev npm run deploy:dev
#         DEV_PUBLIC_URL=https://... npm run deploy:dev    # activa el smoke público
#         DEV_SSH_KEY=~/.ssh/otra_llave npm run deploy:dev
#         DEV_IMAGE=ghcr.io/allopze/bodega-dev:dev npm run deploy:dev
#         DEV_APP_PORT=3001 npm run deploy:dev
#
# Dev corre en el mismo host que producción pero en un proyecto Compose
# separado: /srv/plataforma-dev, con su propio .env, volúmenes, puerto
# APP_PORT y namespace de imagen. No comparte contenedores, red, bases ni los
# tags :latest/:prev de producción.
#
# No es un segundo script de despliegue: fija el destino y delega en
# deploy-prod.sh, así dev ensaya los mismos pasos (migraciones, backfills,
# rollback, smokes) que después corren en prod.
# Diferencias: sin DEV_PUBLIC_URL se omite el smoke por el túnel; se permite
# desplegar una rama de prueba (DEV_ALLOW_NON_MAIN_BRANCH); y usa el puerto
# 3001 para no chocar con el 3000 de producción.
#
# El .env de allá es estado de ese servidor, igual que en prod: si apunta a
# integraciones reales (SII, proveedores de combustible, correo), el cron de
# dev las va a llamar. El .env de dev debe apuntar DATABASE_URL al servicio
# `db` local (vacío) y usar un GITHUB_REPOSITORY/IMAGE_TAG distinto al de prod.
# ─────────────────────────────────────────────────────────────────────────────

export PROD_SSH="${DEV_SSH:-allopze@ssh.portalchome.cl}"
export PROD_DIR="${DEV_DIR:-/srv/plataforma-dev}"
export PROD_SSH_KEY="${DEV_SSH_KEY:-$HOME/.ssh/id_ed25519_migracion}"
# Namespace de imagen propio: el compose de dev resuelve ghcr.io/<repo>:<tag>
# desde su .env; este valor debe coincidir para que resolve_prod_image lo acepte.
export IMAGE="${DEV_IMAGE:-ghcr.io/allopze/bodega-dev:latest}"
export APP_HOST_PORT="${DEV_APP_PORT:-3001}"
export ALLOW_NON_MAIN_BRANCH="${DEV_ALLOW_NON_MAIN_BRANCH:-1}"
# Un entorno de pruebas existe para probar lo que todavía no está commiteado.
# deploy:prod sigue exigiendo un árbol limpio.
export ALLOW_DIRTY_TREE="${DEV_ALLOW_DIRTY_TREE:-1}"
if [ -n "${DEV_PUBLIC_URL:-}" ]; then
  export PROD_PUBLIC_URL="$DEV_PUBLIC_URL"
else
  export SKIP_PUBLIC_SMOKE=1
fi
export DEPLOY_LABEL="dev"

# Evita que un DEV_DIR mal escrito reemplace el compose de producción.
if [ "${PROD_DIR%/}" = "/srv/plataforma" ]; then
  echo "ERROR: DEV_DIR no puede ser /srv/plataforma (directorio de producción)."
  exit 1
fi

exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-prod.sh" "$@"
