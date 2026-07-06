# Runbook operativo

Guia breve para operar Plataforma Chome en produccion.

## Objetivos iniciales

| Indicador | Objetivo |
|---|---|
| Uptime | 99% mensual |
| RPO | 24 horas |
| RTO | 4 horas |
| Backup PostgreSQL | Diario, retencion 30 dias |
| Backup storage | Diario, retencion segun destino externo |

## Backups

### PostgreSQL

Ejecutar en el VPS con `DATABASE_URL` apuntando a produccion:

```bash
DATABASE_URL="$DATABASE_URL" /srv/bodega/scripts/backup-pg.sh
```

Cron recomendado:

```cron
0 3 * * * DATABASE_URL=postgres://... /srv/bodega/scripts/backup-pg.sh >> /var/log/bodega-backup-pg.log 2>&1
```

### Storage

Configurar primero `rclone config` con un destino externo, por ejemplo S3 o Backblaze.

```bash
STORAGE_PATH=/srv/bodega/storage RCLONE_DEST=b2:bodega-prod/storage /srv/bodega/scripts/backup-storage.sh
```

Cron recomendado:

```cron
30 3 * * * STORAGE_PATH=/srv/bodega/storage RCLONE_DEST=b2:bodega-prod/storage /srv/bodega/scripts/backup-storage.sh >> /var/log/bodega-backup-storage.log 2>&1
```

## Restauracion

### Restaurar PostgreSQL en staging

Nunca probar restauraciones sobre produccion. Crear una base temporal o de staging:

```bash
createdb bodega_restore_test
pg_restore --clean --if-exists --no-owner --dbname=bodega_restore_test /backups/bodega-latest.dump
```

Validaciones minimas:

```bash
psql bodega_restore_test -c "select count(*) from purchase_requests;"
psql bodega_restore_test -c "select count(*) from purchase_orders;"
psql bodega_restore_test -c "select count(*) from worksite_stock;"
```

### Restaurar storage en staging

```bash
rclone sync b2:bodega-prod/storage /srv/bodega-restore/storage
find /srv/bodega-restore/storage -type f | head
```

Validar que las rutas de adjuntos en DB existan fisicamente en el storage restaurado.

## Monitoreo

Configurar un monitor externo contra:

```text
https://<dominio-produccion>/api/health
```

Frecuencia recomendada: 5 minutos. Alertas: email y canal operacional.

El endpoint debe responder:

- `200` con `status: "ok"` cuando DB, storage y disco estan bien.
- `200` con `status: "degraded"` si storage o disco requieren atencion.
- `503` con `status: "error"` si la DB no responde.

## Sentry

Configurar `SENTRY_DSN` en GitHub Secrets y en el `.env` del contenedor de produccion. La app inicializa Sentry solo cuando `NODE_ENV=production` y `SENTRY_DSN` existe.

Validacion:

1. Desplegar con `SENTRY_DSN`.
2. Provocar un error controlado en staging.
3. Confirmar evento en el proyecto Sentry.

## Incidentes

1. Revisar `/api/health`.
2. Revisar logs del contenedor:

```bash
docker compose logs --tail=200 app
```

3. Si el deploy reciente fallo, usar el rollback automatico del workflow o redeplegar el SHA anterior.
4. Si hay perdida/corrupcion de datos, congelar escrituras antes de restaurar.
5. Restaurar primero en staging y validar conteos/tablas criticas.
6. Documentar hora de inicio, causa probable, acciones tomadas y hora de cierre.

## Tareas recurrentes

| Tarea | Frecuencia |
|---|---|
| Verificar que existan backups recientes | Diaria |
| Probar restauracion en staging | Mensual |
| Revisar eventos Sentry abiertos | Semanal |
| Revisar espacio en disco | Semanal |
| Revisar uptime mensual | Mensual |
