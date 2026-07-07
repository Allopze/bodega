# Cutover al baseline único de migraciones

> Contexto: el 2026-06-25 se colapsaron las 28 migraciones históricas en un
> baseline único (`db/migrations/0000_vengeful_hulk.sql`) porque el journal de
> Drizzle tenía timestamps `when` no monótonos (valores falsos-futuros) que
> hacían que `drizzle-kit migrate` incremental **saltara migraciones en
> silencio** (misma causa del incidente de la columna `email_notifications`).
>
> El baseline = esquema completo (generado desde `db/schema`) + funciones y
> triggers idempotentes que el esquema TS no captura (`next_document_code`,
> `set_updated_at` + triggers, `cleanup_old_audit_log`,
> `archive_old_inventory_movements` y la tabla `inventory_movements_archive`).
> El seed operativo ya no crea RBAC ni usuarios: solo carga faenas/trabajadores
> y el catálogo EPP. El bootstrap de usuarios debe hacerse desde los flujos de
> registro/administración vigentes.

## Estado actual

- **Dev** (`bodega`): ya recreada desde el baseline + seed. `__drizzle_migrations`
  tiene un único registro. `drizzle-kit generate` no detecta cambios.
- **Producción**: cutover **pendiente** (marcha blanca, sin datos relevantes).

## Verificación previa hecha

- BD fresca aplicada con el runner real (`scripts/migrate.mjs`) reproduce el
  esquema actual de dev (comparación de firmas normalizadas: columnas,
  constraints, índices, funciones, triggers).
- `db:seed` corre limpio sobre el baseline (faenas, trabajadores y catálogo EPP).
- `drizzle-kit generate` reporta "No schema changes" → el baseline reproduce
  exactamente `db/schema`, así que las migraciones futuras funcionan normal.

## Cutover de PRODUCCIÓN (manual, una sola vez)

Ejecutar en una ventana de mantención, **independiente del auto-deploy**, para
controlar el orden (el job `migrate` de `deploy.yml` corre `npm run db:migrate`
antes del rollout; si la BD vieja todavía tiene registros de migración con
`created_at` alto, saltaría el baseline — por eso hay que limpiar primero).

```bash
# 1) Respaldo por si acaso
pg_dump "<PROD_DATABASE_URL>" > backup-prod-$(date +%F).sql

# 2) Limpiar la BD (marcha blanca, sin datos relevantes)
psql "<PROD_DATABASE_URL>" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;'

# 3) Aplicar el baseline (crea esquema + funciones/triggers, registra 1 migración)
DATABASE_URL="<PROD_DATABASE_URL>" npm run db:migrate

# 4) Sembrar faenas/trabajadores + catálogo EPP
DATABASE_URL="<PROD_DATABASE_URL>" npm run db:seed
```

### Después del cutover

- Los deploys normales (`deploy.yml` → `db:migrate`) quedan como **no-op** hasta
  la próxima migración real.
- **Usuarios**: tras recrear la BD, crear o invitar usuarios desde los flujos
  vigentes de la app. El seed no crea cuentas ni permisos.

## Migraciones futuras (flujo normal restablecido)

```bash
# 1) Editar db/schema/*.ts
# 2) Generar la migración incremental
npm run db:generate
# 3) Aplicar
DATABASE_URL="<...>" npm run db:migrate
```

Para SQL custom no gestionado por el esquema (funciones, triggers, datos),
añadir las sentencias idempotentes al final del archivo de migración generado,
separadas por `--> statement-breakpoint`.
