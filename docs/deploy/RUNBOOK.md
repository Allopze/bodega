# Runbook de operación

Qué mirar cuando algo se cae, en qué orden, y qué NO hacer. Los respaldos y la
restauración viven en [RESPALDOS_Y_RESTAURACION.md](RESPALDOS_Y_RESTAURACION.md) y no se
repiten acá: este documento cubre detección, diagnóstico y recuperación de un incidente.

## Señales

| Señal | Dónde | Qué significa |
|---|---|---|
| `GET /api/health` | `app/api/health/route.ts` | 503 si Postgres no responde, el volumen no es escribible o el disco está bajo el umbral. Es la misma medición que muestra `/admin/modulos` (`lib/services/platform-health.ts`) |
| `HEALTHCHECK` de Docker | `docker-compose.yml` | Pega a `/api/health` cada 30 s, 3 reintentos, 15 s de gracia al arranque. Un contenedor `unhealthy` ya falló tres veces seguidas |
| Sentry | `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation-client.ts` | Excepciones de servidor, edge y cliente. Sin `NEXT_PUBLIC_SENTRY_DSN` definido no se reporta nada |
| Cobertura de snapshots operacionales | workflow `operational-snapshot-health` (diario, 04:35 UTC) | Los snapshots dejaron de generarse o quedaron incompletos |
| Verificación diaria de respaldo | ver RESPALDOS_Y_RESTAURACION.md § "Verificación diaria" | El snapshot del día no se produjo o no se pudo descifrar |

## Triage: de la alerta al servicio

Antes de tocar nada, ubicar la falla en una de tres capas. El orden importa: reiniciar la
app cuando el problema es la base sólo agrega un arranque fallido al historial.

1. **¿Responde la app?** `curl -sS -o /dev/null -w '%{http_code}' http://<host>/api/health`
   - Sin respuesta / conexión rechazada → el contenedor `app` no está arriba: `docker compose ps`, `docker compose logs --tail=200 app`.
   - `503` → la app está viva pero una dependencia no. El cuerpo de la respuesta dice cuál (base, volumen o disco). Seguir al punto correspondiente.
   - `200` → el problema no es de plataforma; es funcional. Ir a Sentry y al módulo afectado.
2. **¿Responde la base?** `docker compose exec db pg_isready`
   - Si la base está caída, la app queda en 503 por diseño y no hay que reiniciarla: se recupera sola cuando `db` vuelve.
3. **¿Hay disco?** `df -h` en el host, mirando el volumen de datos y el de respaldos.
   - El healthcheck avisa bajo 10% o bajo 1 GB libre. Un disco lleno también detiene los respaldos, así que se atienden los dos.

## Un deploy dejó la aplicación rota

El pipeline (`.github/workflows/deploy.yml`) corre en este orden: `build-and-push` →
`migrate` → `sync-rbac`. Conviene identificar en cuál de los tres quedó.

- **Falló `migrate`**: la imagen nueva existe pero el esquema quedó atrás. `db:verify-migrations` corre antes de `db:migrate` justo para frenar acá. No promover la imagen; resolver la migración primero. `drizzle-kit migrate` es idempotente, así que reintentar es seguro.
- **Falló `sync-rbac`**: el esquema está al día pero los permisos no. Síntoma típico: pantallas que responden 403 a quien debería entrar. Los permisos se derivan de los manifiestos de módulo, así que el paso se puede reejecutar solo.
- **La imagen arrancó y falla**: volver al tag anterior. Las imágenes están en `ghcr.io` y `docker-compose.yml` toma `IMAGE_TAG`, así que un rollback es fijar el tag previo y recrear el servicio.

> **Un rollback de imagen no revierte migraciones.** Si el deploy aplicó una migración
> destructiva, volver a la imagen anterior deja código viejo contra esquema nuevo. Ese
> caso se trata como restauración de base, no como rollback — ver
> [MIGRATION_BASELINE_CUTOVER.md](MIGRATION_BASELINE_CUTOVER.md) y el procedimiento de
> restauración.

## Servicios auxiliares

Corren bajo perfiles de compose y su caída **no** tumba la aplicación, pero sí degrada en
silencio; por eso conviene revisarlos cuando algo "dejó de actualizarse solo".

- `backup-scheduler` (perfil `backup`): respaldo diario a `BACKUP_HOUR` UTC, retención `RETENTION_DAYS` (30 por defecto), destino remoto opcional `GDRIVE_BACKUPS_DEST`.
- `cron`: tareas programadas de la plataforma. Requiere `CRON_SECRET`.
- `migrate`, `sync-rbac`, `normalize-epp-skus`: `restart: "no"`, son de un solo tiro. Que estén detenidos es lo normal.

## Objetivos de servicio

**Pendiente de definición del dueño del servicio.** No hay SLO, RPO ni RTO comprometidos
en el repositorio, y ponerle cifras acá sin esa decisión sería inventarlas. Lo que sí está
determinado hoy por la configuración:

- La periodicidad del respaldo es diaria, así que la pérdida máxima de datos que la
  configuración actual admite es de **hasta 24 horas** (el intervalo entre snapshots). Es
  una consecuencia de `backup-scheduler`, no un compromiso acordado.
- El healthcheck detecta una caída dura en **hasta ~105 s** (15 s de gracia + 3 × 30 s).

Al fijar los objetivos, anotarlos acá junto con quién los aprobó y contra qué se miden.

## Qué no hacer

- No editar la base a mano para "destrabar" un deploy: el esquema lo gobiernan las migraciones y un cambio manual rompe `db:verify-migrations` en el deploy siguiente.
- No borrar el volumen de respaldos para liberar disco. Primero ampliar o mover el montaje (ver RESPALDOS § "Dónde quedan los archivos en el host").
- No desactivar el healthcheck para que un contenedor "se vea sano". Marca `unhealthy` porque una dependencia real no responde.
