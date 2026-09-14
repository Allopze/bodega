# Respaldos y restauración

Procedimiento operativo del respaldo diario y de la restauración en un servidor
nuevo. Lo crítico está en la sección **Passphrase de cifrado**: sin ella el
respaldo no se puede abrir, y no hay forma de recuperarlo.

## Qué se respalda

`scripts/backup-orchestrator.sh` (cron diario, 03:00) produce un *snapshot* por
fecha en `${BACKUP_DIR}/snapshots/YYYY-MM-DD/`. Los destinos se configuran desde
**Administración › Respaldos › Destinos**: local (siempre, path fijado por
infraestructura), Cloudreve (WebDAV) y, opcionalmente, Google Drive vía rclone.

| Archivo             | Contenido                                                       |
| ------------------- | --------------------------------------------------------------- |
| `postgres.dump`     | `pg_dump -Fc --compress=9` de la base completa                    |
| `storage.tar.gz`    | Volumen de adjuntos (`STORAGE_PATH`)                              |
| `env-config.tar.gz` | `.env` (whitelist de variables), `system-info.json`, volúmenes    |
| `manifest.json`     | sha256 y tamaño de los tres anteriores, versión de app, hostname  |

No entran al respaldo, a propósito:

- `rclone.conf` y el Service Account JSON de Drive — son las credenciales del
  destino; viajaban dentro de lo que protegen. Se sacan del gestor de secretos y
  se pasan al restore con `--service-account-json`.
- `BACKUP_ENCRYPTION_PASSPHRASE` — ver abajo.

### Dónde quedan los archivos en el host

Dentro de los contenedores los respaldos se escriben en `/data/backups`
(`BACKUP_DIR`). Qué hay detrás de ese path lo decide el `docker-compose.yml`:

- Por defecto, el volumen nombrado `bodega-backups` (bajo
  `/var/lib/docker/volumes/`, invisible en el filesystem del host).
- Si `BACKUP_HOST_PATH` (`.env` del host) apunta a una ruta absoluta — p. ej.
  `/srv/backups/plataforma` — esa ruta se monta como bind mount en `app` y en
  `backup-scheduler`, y los snapshots quedan directamente en el servidor.

Al usar una ruta del host, el directorio debe existir y ser escribible por el
uid del contenedor: los servicios corren como `nextjs` (uid 1001).

```bash
sudo mkdir -p /srv/backups/plataforma
sudo chown 1001:1001 /srv/backups/plataforma
echo 'BACKUP_HOST_PATH=/srv/backups/plataforma' >> /srv/plataforma/.env
# recrear los servicios para que tome el montaje nuevo
docker compose up -d --no-deps --force-recreate app
docker compose --profile backup up -d --force-recreate backup-scheduler
```

Migración opcional del histórico que ya vive en el volumen nombrado:

```bash
docker volume ls | grep bodega-backups   # nombre real (prefijo del proyecto)
docker run --rm -v <nombre-volumen>:/from -v /srv/backups/plataforma:/to \
  alpine sh -c 'cp -a /from/. /to/ && chown -R 1001:1001 /to'
```

Tras el primer respaldo, confirma los archivos en
`/srv/backups/plataforma/snapshots/<fecha>/` y corre `backup-verify.sh`.

## Destinos (configurables desde Admin)

En **Administración › Respaldos › Destinos**:

- **Local** — siempre activo. El snapshot se escribe en `${BACKUP_DIR}` (ver
  arriba); el path del host lo fija el bind mount (`BACKUP_HOST_PATH`), no se
  edita desde Admin.
- **Cloudreve (WebDAV)** — toggle + carpeta remota (`cloudreve_backups_path`,
  default `backups/plataforma`) + botón *Probar conexión*. Reutiliza las
  credenciales de **Administración › Almacenamiento de documentos**. Si el
  upload falla (o no hay credenciales), el respaldo se marca **fallido**: no se
  deja una «copia remota» que en realidad no existe.
- **Google Drive** — desactivado por defecto. Requiere rclone + Service Account;
  su código se conserva para poder reactivarlo.

La subida a Cloudreve la hace `scripts/upload-backup-cloudreve.cjs` (invocado por
el orquestador). La restauración desde Cloudreve usa
`scripts/download-backup-cloudreve.cjs`:

```bash
# dentro del contenedor (o en un host con la copia del .cjs):
RESTORE_SOURCE=cloudreve CLOUDREVE_BACKUP_PATH=backups/plataforma \
  ./scripts/restore-all.sh --source=cloudreve
```

Para un host nuevo, `catastrophic-restore.sh` sigue siendo el camino de
bootstrap; apunta a la copia Cloudreve con las mismas variables.

## Cifrado del snapshot

Con `BACKUP_ENCRYPTION_PASSPHRASE` definida en el entorno del host de respaldo,
el orquestador cifra los tres artefactos antes de subirlos (gpg simétrico,
AES256) y sube `postgres.dump.gpg`, `storage.tar.gz.gpg` y
`env-config.tar.gz.gpg`. El `manifest.json` viaja **en claro**: sólo contiene
checksums y es lo primero que lee el restore.

Detalle que importa al restaurar: **los sha256 del manifiesto son los del
archivo antes de cifrar**. Por eso el orden obligatorio es *descifrar y después
verificar*; `scripts/catastrophic-restore.sh` lo hace en ese orden. Verificar el
`.gpg` contra el manifiesto falla siempre, y ese falso negativo parece
"respaldo corrupto".

Sin la variable el snapshot sube **en claro**, y eso incluye el dump con los
sobres `enc:v1:` de las credenciales del portal DTE y de Chipax *junto a*
`DTE_SETTINGS_KEYRING`, la llave que los abre. En producción la variable debe
estar puesta.

### Cómo entra en los contenedores

Se define en el `.env` del host y `docker-compose.yml` la pasa por variable
(passthrough, nunca un literal en el archivo) a **dos** servicios:

- `backup-scheduler` — el respaldo diario programado.
- `app` — el botón de *Administración › Respaldos*, que invoca al mismo
  orquestador. Si sólo estuviera en el scheduler, el respaldo manual subiría en
  claro mientras el programado va cifrado: media copia protegida y una
  configuración que afirma lo contrario.

**Definirla no basta: hay que recrear los contenedores** para que entre.

```bash
docker compose up -d app
docker compose --profile backup up -d backup-scheduler
```

Hasta entonces el respaldo sigue subiendo en claro; el orquestador lo advierte
en su log, que es la señal a mirar después de configurarla.

### Qué restaurador usar

Los **dos** aceptan snapshots cifrados con la misma variable en el entorno:

- `scripts/restore-all.sh` — el de uso corriente.
- `scripts/catastrophic-restore.sh` — el de host nuevo desde cero.

Ambos descifran primero y verifican después, en ese orden.

### Passphrase de cifrado — dónde vive

- **Gestor de secretos corporativo**, entrada `Chome — BACKUP_ENCRYPTION_PASSPHRASE`.
- **Copia sellada fuera de línea** en la caja fuerte de gerencia (sobre con la
  fecha de la última rotación).
- **Nunca** dentro del snapshot, ni en `.env` respaldado, ni en el repositorio.
  `scripts/backup-env-whitelist.test.ts` falla si alguien la agrega a la
  whitelist del respaldo de configuración.

> **No la pongas en `/srv/bodega/.env`.** Cuando ese archivo existe, el
> orquestador lo copia **verbatim** dentro de `env-config.tar.gz`: la whitelist
> sólo protege el caso Docker, donde el `.env` se genera desde el entorno. Una
> passphrase escrita ahí viaja cifrada con ella misma dentro del respaldo que
> protege, y cualquiera que obtenga un snapshot obtiene los 30 retenidos.
>
> Ponla en el entorno del proceso que corre el respaldo, fuera de la ruta
> respaldada. Por ejemplo, en la línea de cron:
>
> ```cron
> 0 3 * * * . /root/.bodega-backup-secrets && /srv/bodega/scripts/backup-orchestrator.sh >> /var/log/bodega-backup.log 2>&1
> ```
>
> con `/root/.bodega-backup-secrets` en modo `600`, conteniendo sólo
> `export BACKUP_ENCRYPTION_PASSPHRASE='...'`.

**Sin la passphrase el respaldo es irrecuperable.** No hay recuperación
alternativa: no es una llave derivada ni escrowed, es gpg simétrico.

### Rotación

1. Guarda la passphrase nueva en el gestor de secretos **sin borrar la anterior**:
   los snapshots ya subidos sólo se abren con la que estaba vigente ese día.
2. Cambia la variable en el entorno del host (compose / systemd / cron) y reinicia.
3. Espera el próximo respaldo y corre `scripts/backup-verify.sh` — el ensayo de
   descifrado confirma que la passphrase nueva abre el snapshot nuevo.
4. Conserva las passphrases retiradas al menos `RETENTION_DAYS` (30 días) más.

## Verificación diaria

```bash
sudo /srv/bodega/scripts/backup-verify.sh          # legible
sudo /srv/bodega/scripts/backup-verify.sh --json   # para monitoreo
```

Exit `0` OK, `1` WARNING, `2` CRITICAL. Además de edad, tamaño y presencia en
Drive, si el snapshot remoto está cifrado baja `env-config.tar.gz.gpg` (unos KB)
y lo descifra hacia `/dev/null`: prueba real de que la passphrase de este host
abre el snapshot de hoy. Si no la abre, el resultado es CRITICAL — es el único
momento en que ese problema se puede arreglar todavía.

Para que el ensayo corra, `BACKUP_ENCRYPTION_PASSPHRASE` tiene que estar en el
entorno del proceso que ejecuta `backup-verify.sh` (el mismo del cron de
respaldo). Si falta, el resultado es WARNING: los respaldos siguen subiendo
cifrados, pero nadie está comprobando que sean recuperables.

## Ensayo semanal de restauración

La verificación diaria comprueba que el respaldo exista, pese lo suyo y que la
passphrase lo abra. Ninguna de esas tres cosas dice que el dump **se pueda
restaurar**: un `pg_dump` truncado por un disco lleno a mitad de escritura las
pasa todas y falla el día del desastre. Eso es lo que ensaya
`backup-restore-drill.sh`.

```bash
sudo DRILL_DATABASE_URL='postgres:///bodega_drill' \
  /srv/bodega/scripts/backup-restore-drill.sh          # legible
sudo ... /srv/bodega/scripts/backup-restore-drill.sh --json
```

Restaura `backups/pg/bodega-latest.dump` —el artefacto que restauraría una
persona de verdad, no uno hecho para la ocasión— en una base desechable, y exige
que lo restaurado tenga al menos `DRILL_MIN_TABLES` tablas **y datos**: un dump
truncado suele traer el esquema y ningún registro.

`DRILL_DATABASE_URL` **se destruye en cada ensayo** (`DROP SCHEMA public
CASCADE`). Nunca apuntarla a la base de la aplicación. Si está vacía el ensayo
no corre y el resultado es WARNING, no OK: un ensayo que no se hizo no prueba
nada.

Periodicidad: `backup-scheduler.sh` lo dispara una vez por semana
(`RESTORE_DRILL_WEEKDAY`, por defecto domingo) justo después del respaldo del
día. El resultado queda en `${BACKUP_DIR}/restore-drill.json` y lo recoge
`backup-verify.sh`, que lo convierte en alerta del mismo canal:

| Situación | Resultado de la verificación diaria |
| --- | --- |
| Nunca se ensayó | WARNING |
| El último ensayo tiene más de `DRILL_MAX_AGE_DAYS` (8) | WARNING |
| El ensayo no pudo ejecutarse | WARNING |
| El ensayo falló | **CRITICAL** — ese respaldo no es restaurable |

## Restauración catastrófica (servidor nuevo)

```bash
sudo BACKUP_ENCRYPTION_PASSPHRASE='<passphrase>' \
  ./scripts/catastrophic-restore.sh \
  --service-account-json /ruta/al/sa.json \
  [--date 2026-08-19]   # default: latest
```

Lo que necesitas a mano **antes** de empezar:

1. El Service Account JSON de Drive (gestor de secretos).
2. La `BACKUP_ENCRYPTION_PASSPHRASE` vigente en la fecha del snapshot que vas a
   restaurar. Si te equivocas, el script lo dice y sugiere probar la anterior; no
   deja archivos a medio descifrar.
3. Los secretos que el respaldo no guarda: `AUTH_SECRET`,
   `PREVENTION_DATA_ENCRYPTION_KEY`, `CRON_SECRET`.

El script instala dependencias, configura rclone, baja el snapshot, descifra,
verifica checksums, restaura configuración, storage y PostgreSQL, aplica
migraciones y levanta la app.

### Después de restaurar

Vuelve a inyectar `BACKUP_ENCRYPTION_PASSPHRASE` en el entorno del host nuevo.
No viene en el `.env` restaurado, así que sin este paso los respaldos del
servidor recuperado suben **sin cifrar**. Confírmalo con `backup-verify.sh`
después del primer respaldo.

## Ensayo en desarrollo

- `bash scripts/dev-backup-test.sh` — ciclo dump → validate → restore contra
  `bodega_e2e`, sin tocar Drive (no ejercita el cifrado).
- `npx vitest run --config vitest.non-pglite.config.ts scripts/backup-encryption.test.ts`
  — fija la costura orchestrator ↔ restore (nombres `.gpg`, AES256, orden
  descifrar→verificar) y ensaya con gpg real el descifrado, la passphrase
  ausente, la equivocada y el snapshot incompleto.
