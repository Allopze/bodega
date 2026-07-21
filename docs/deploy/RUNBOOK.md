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

Los backups se ejecutan automáticamente dentro de Docker mediante el servicio
`backup-scheduler`. Una vez activado con el perfil `backup`, el scheduler ejecuta
el orquestador completo (`backup-orchestrator.sh`) una vez al día a las `BACKUP_HOUR`
UTC (default: 3 AM).

```bash
# Activar scheduler diario de backups
docker compose --profile backup up -d backup-scheduler
```

El servicio está programado para ejecutarse a las 3 AM UTC por defecto.
Para cambiar la hora, configurar `BACKUP_HOUR` en `.env`:

```env
# Hora UTC del backup diario (0-23)
BACKUP_HOUR=3
```

El scheduler espera a que la app esté healthy, ejecuta `backup-orchestrator.sh`
y reporta el resultado al endpoint `/api/cron/backup-health`.

### Monitoreo de edad del backup

El endpoint `/api/cron/backup-health` (protegido por `CRON_SECRET`) verifica
que el último backup exitoso tenga menos de 36 horas. Programar vía cron externo
(UptimeRobot, healthchecks.io, Vercel Cron):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/cron/backup-health
```

Responde:
- `{"status":"healthy"}` — último backup OK, <36h
- `{"status":"critical"}` — sin backup o último >36h

El scheduler interno ya llama a este endpoint después de cada backup.

## Restauracion

### Probar ciclo completo en desarrollo

El script `scripts/dev-backup-test.sh` ejecuta un backup → validate → restore
a `bodega_e2e` con conteo de tablas. No requiere Google Drive ni Docker.

```bash
bash scripts/dev-backup-test.sh
```

Esto verifica que pg_dump, pg_restore y la validación de estructura del dump
funcionan correctamente en el entorno local.

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

## Backfill de identidad de proveedores de combustible

El enlace entre `fuel_suppliers` y `suppliers` se puede revisar sin escribir datos.
Ejecutar siempre el DRY-RUN en la base objetivo antes de aplicar cualquier vínculo:

```bash
DATABASE_URL="<URL_DEL_ENTORNO>" npm run db:normalize-fuel-suppliers
```

El reporte separa vínculos seguros por RUT, coincidencias solo por nombre, casos
ambiguos y proveedores sin coincidencia. Las coincidencias solo por nombre, ambiguas
y sin RUT requieren revisión manual; el script no las fusiona.

Después de un backup reciente y de aprobar el reporte, aplicar únicamente las
coincidencias únicas por RUT:

```bash
DATABASE_URL="<URL_DEL_ENTORNO>" npm run db:normalize-fuel-suppliers -- --apply
```

Orden recomendado: base de pruebas/restauración, staging y finalmente producción.
Guardar la salida de ambos comandos junto con la fecha, el SHA desplegado y la
confirmación de revisión. No ejecutar `--apply` como parte del deploy automático.

## Tareas recurrentes

| Tarea | Frecuencia |
|---|---|
| Verificar que el backup-scheduler esté corriendo (`docker compose ps`) | Semanal |
| Verificar endpoint `/api/backups/status` (panel admin) | Diaria |
| Probar restauracion en staging (`bash scripts/dev-backup-test.sh`) | Mensual |
| Revisar eventos Sentry abiertos | Semanal |
| Revisar espacio en disco | Semanal |
| Revisar uptime mensual | Mensual |
