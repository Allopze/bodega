# Respaldos y restauración

Procedimiento operativo del respaldo diario y de la restauración en un servidor
nuevo. Lo crítico está en la sección **Passphrase de cifrado**: sin ella el
respaldo no se puede abrir, y no hay forma de recuperarlo.

## Qué se respalda

`scripts/backup-orchestrator.sh` (cron diario, 03:00) produce un *snapshot* por
fecha en `${BACKUP_DIR}/snapshots/YYYY-MM-DD/` y lo sube a Google Drive vía
rclone:

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
