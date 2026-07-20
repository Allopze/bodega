# Bitácora de Rotación de Secretos

| Fecha | Secreto rotado | Valor anterior (hash/desc) | Valor nuevo (hash/desc) | Operador | Validación post-rotación |
|-------|---------------|---------------------------|------------------------|----------|--------------------------|
| _(ejemplo)_ 2026-07-20 | `AUTH_SECRET` | `sha256:abc123...` | `sha256:def456...` | operador@chome.cl | `/api/health` OK, login funcional |

## Procedimiento de rotación

Ver `scripts/rotate-secrets.sh` para el checklist completo. Orden recomendado:

1. **Brevo (SMTP)** — Panel web, rotar SMTP key, actualizar `.env`
2. **AUTH_SECRET** — `openssl rand -base64 32`, actualizar `.env`, reiniciar app (invalida sesiones)
3. **DATABASE_URL password** — `ALTER USER`, actualizar `.env`, reiniciar contenedor
4. **Passwords de usuarios** — Desde la app, no por SQL directo
5. **PREVENTION_DATA_ENCRYPTION_KEY** — Rotar desde password manager, coordinar con re-cifrado de blobs SST

## Frecuencia recomendada

- `AUTH_SECRET`: cada 90 días
- `PREVENTION_DATA_ENCRYPTION_KEY`: cada 180 días o ante incidente de seguridad
- Claves SMTP: cada 180 días
- Password de BD: cada 180 días

## Responsable

Última revisión: _(fecha)_ — _(nombre/rol)_
