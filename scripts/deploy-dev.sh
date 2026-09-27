#!/usr/bin/env bash
set -euo pipefail

# ── Deploy al entorno de pruebas (ssh.allopze.dev) ──────────────────────────
# Usage:  npm run deploy:dev
#         DEV_SSH=usuario@host npm run deploy:dev
#         DEV_DIR=/srv/plataforma npm run deploy:dev
#         DEV_PUBLIC_URL=https://... npm run deploy:dev    # activa el smoke público
#         DEV_SSH_KEY=~/.ssh/otra_llave npm run deploy:dev
#
# No es un segundo script de despliegue: fija el destino y delega en
# deploy-prod.sh, así dev ensaya los mismos pasos (migraciones, backfills,
# rollback, smokes) que después corren en prod, también sólo desde `main`.
# Única diferencia: sin DEV_PUBLIC_URL se omite el smoke por el túnel.
# El .env de allá es estado de ese servidor, igual que en prod: si apunta a
# integraciones reales (SII, proveedores de combustible, correo), el cron de
# dev las va a llamar.
# ─────────────────────────────────────────────────────────────────────────────

export PROD_SSH="${DEV_SSH:-allopze@ssh.allopze.dev}"
export PROD_DIR="${DEV_DIR:-/srv/plataforma}"
export PROD_SSH_KEY="${DEV_SSH_KEY:-$HOME/.ssh/id_ed25519_migracion}"
if [ -n "${DEV_PUBLIC_URL:-}" ]; then
  export PROD_PUBLIC_URL="$DEV_PUBLIC_URL"
else
  export SKIP_PUBLIC_SMOKE=1
fi
export DEPLOY_LABEL="dev"

exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-prod.sh" "$@"
