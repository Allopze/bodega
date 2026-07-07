#!/usr/bin/env bash
#
# scripts/rotate-secrets.sh
#
# Rotación de secretos externos del SaaS.
# Este script NO rota automáticamente — documenta el procedimiento y deja
# un checklist explícito. La razón es que cada proveedor requiere acción
# humana en su panel web.
#
# Uso:
#   bash scripts/rotate-secrets.sh check   # muestra el último estado
#   bash scripts/rotate-secrets.sh help    # imprime este mensaje
#
# Procedimiento (orden recomendado):
#   1. Brevo (SMTP):
#      - Panel: https://app.brevo.com/settings/keys/smtp
#      - Crear nueva SMTP key, desactivar la anterior.
#      - En .env.local y en el secret manager de producción:
#          SMTP_USER=<nuevo>
#          SMTP_PASS=<nuevo>
#      - Verificar envío con `npm run check:secrets` + smoke test manual.
#
#   2. AUTH_SECRET (NextAuth):
#      - Generar nuevo valor: openssl rand -base64 32
#      - Actualizar el secret en el orquestador (Vercel env, K8s secret,
#        GitHub Actions secret, etc.).
#      - IMPORTANTE: rotar AUTH_SECRET invalida todas las sesiones activas;
#        coordinar con horario de baja actividad.
#
#   3. DATABASE_URL password (si aplica):
#      - `ALTER USER bodega_app PASSWORD '<nuevo>'` en Postgres.
#      - Rotar el secret en el orquestador.
#      - Reiniciar el contenedor para que tome el nuevo valor.
#
#   4. Passwords de usuarios:
#      - Rotar desde la app o mediante el flujo de recuperación/registro.
#      - Re-hashear y actualizar vía admin/usuarios (no por SQL directo).
#
# Post-rotación:
#   - Revisar audit_log y status_history por errores de autenticación.
#   - Confirmar que /api/health responde 200 con la nueva BD.
#   - Revisar la cola de notificaciones (no deberían haberse perdido).
#

set -euo pipefail

cmd="${1:-help}"

case "$cmd" in
  check)
    echo "== Secretos en .env.example (referencia) =="
    grep -E '^[A-Z_]+=' .env.example | head -30
    echo
    echo "== Secretos en .env.local (NO versionado) =="
    if [ -f .env.local ]; then
      grep -cE '^[A-Z_]+=' .env.local | sed 's/^/  Líneas: /'
      echo "  (verificar manualmente que SMTP_PASS y AUTH_SECRET no son los defaults)"
    else
      echo "  .env.local no existe"
    fi
    echo
    echo "== ¿Cuándo fue la última rotación? =="
    echo "  Rellenar manualmente en docs/security/SECRET_ROTATION_LOG.md"
    ;;
  help|*)
    sed -n '2,55p' "$0"
    ;;
esac
