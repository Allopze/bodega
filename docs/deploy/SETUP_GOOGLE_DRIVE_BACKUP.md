# Configuración de Google Drive para Backups

Guía para crear un **Service Account** de Google Cloud que permita al sistema
de backups subir archivos a Google Drive mediante autenticación
**servidor-a-servidor** (OAuth 2.0 con cuentas de servicio).

> ⚠️ **Diferencia clave:** Este setup usa una **cuenta de servicio**, no el flujo
> OAuth 2.0 de usuario final. Una cuenta de servicio pertenece a tu aplicación,
> no a una persona. No requiere pantalla de consentimiento ni refresh tokens.
> La autenticación usa un archivo JSON con clave privada que firmamos para
> generar JWT. Más info en la [documentación oficial de Google](https://developers.google.com/identity/protocols/oauth2/serviceaccount).

---

## 1. Crear cuenta Gmail dedicada (dueña del Drive)

1. Ve a https://accounts.google.com/signup
2. Crea una cuenta con nombre tipo `bodega-backups` o `chome-backups`
3. **Importante:** anota el correo completo (ej: `chome-backups@gmail.com`)

Esta cuenta **no** se usa para autenticar el backup (eso lo hace el Service
Account). Se usa como **dueña** del Drive donde se compartirá la carpeta de
backups.

---

## 2. Crear proyecto en Google Cloud Console

1. Ve a https://console.cloud.google.com/
2. Inicia sesión con **tu cuenta principal** (la dueña del proyecto GCP)
3. Crea un proyecto nuevo:
   - Click en el selector de proyectos (arriba a la izquierda)
   - "Nuevo proyecto"
   - Nombre: `bodega-backups` (o el que prefieras)
   - Click "Crear"

---

## 3. Habilitar Google Drive API

1. En el proyecto, ve a **APIs & Services > Library**
2. Busca "Google Drive API"
3. Click en **Enable**

> **¿Por qué no se necesita OAuth Consent Screen?** Las cuentas de servicio
> no usan el flujo de autorización de usuario final. Se autentican mediante
> JWT firmados con su clave privada. Google asigna un token de acceso
> directamente, sin intervención del usuario. Por lo tanto, los pasos de
> "OAuth Consent Screen" y "Test Users" **no aplican**.

---

## 4. Crear Service Account

1. Ve a **IAM & Admin > Service Accounts**
2. Click **+ Create Service Account**
3. Datos:
   - **Service account name:** `bodega-backup-sa`
   - **Service account ID:** se autogenera (ej: `bodega-backup-sa@...`)
   - **Description:** `Servicio de backups automáticos a Google Drive`
4. Click **Create and Continue**
5. En "Grant this service account access to project":
   - Rol: `Basic > Viewer` (solo lectura del proyecto, suficiente)
   - Click **Continue**
6. En "Grant users access to this service account":
   - Se puede dejar vacío (opcional, si otros usuarios necesitan impersonar)
7. Click **Done**

---

## 5. Generar clave JSON del Service Account

1. En la lista de Service Accounts, click en el que acabas de crear
2. Ve a la pestaña **Keys**
3. Click **Add Key > Create New Key**
4. Selecciona **JSON**
5. Click **Create** — se descargará un archivo `.json`

### ⚠️ PROTEGE ESTE ARCHIVO

El JSON contiene la **clave privada** del Service Account. Quien tenga este
archivo puede autenticarse como el Service Account y acceder a los recursos
compartidos con él (la carpeta de backups en Drive).

- **Nunca** lo subas a git (ya está en `.gitignore`)
- **Nunca** lo compartas por Slack, email, etc.
- Guárdalo en el **password manager corporativo** (Bitwarden/1Password)
- Guarda una **copia offline** en un lugar seguro

### Estructura del archivo JSON

El archivo descargado contiene (entre otros campos):

```json
{
  "type": "service_account",
  "project_id": "bodega-backups",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "bodega-backup-sa@bodega-backups.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

### Colocar la clave en el servidor

```bash
sudo mkdir -p /srv/bodega/secrets
sudo mv resplado-plataforma-26fc4abadba6.json /srv/plataforma/secrets/resplado-plataforma-26fc4abadba6.json
sudo chmod 600 /srv/plataforma/secrets/resplado-plataforma-26fc4abadba6.json
```

---

## 6. Compartir carpeta de Drive con el Service Account

El Service Account **no tiene** un Google Drive propio. Para que pueda
escribir archivos, debes compartir una carpeta con su correo electrónico.

El correo del Service Account tiene el formato:
```
bodega-backup-sa@<tu-proyecto>.iam.gserviceaccount.com
```
Puedes verlo en la consola o dentro del JSON descargado (campo `client_email`).

1. Inicia sesión en Gmail con la **cuenta dedicada** que creaste en el paso 1
2. Ve a Google Drive: https://drive.google.com/
3. Crea una carpeta llamada `bodega-backups`
4. Click derecho en la carpeta > **Compartir**
5. Agrega el correo del Service Account (terminado en `iam.gserviceaccount.com`)
6. Permiso: **Editor**
7. Quita la marca de "Notificar" (no es necesario enviar email)
8. Click **Compartir**

### ¿Por qué permisos de Editor y no Lector?

El Service Account necesita permiso **Editor** para:
- `drive.file` scope: crear y escribir archivos de backup
- Solo puede acceder a archivos que **él mismo crea** o que son **explícitamente
  compartidos** con él. No puede ver todo tu Drive.
- Si usaras solo permiso de Lector, el backup fallaría al intentar escribir.

### ¿Qué alcance (scope) usa rclone?

```bash
rclone config create gdrive-backups drive \
  scope drive.file \
  service_account_file /srv/bodega/secrets/gdrive-service-account.json
```

El scope `drive.file` (`https://www.googleapis.com/auth/drive.file`) es el
**más restrictivo** que permite escritura. Solo otorga acceso a:
- Archivos que la aplicación crea
- Archivos compartidos explícitamente con ella

> No uses `drive` (acceso total a todo el Drive del usuario) — es innecesario
> y riesgoso.

---

## 7. Configurar rclone en el servidor

> **Nota:** `rclone` ya viene instalado en la imagen Docker de producción
> (`Dockerfile` stage `prod`). Solo es necesario configurarlo una vez en el
> host o montar el `rclone.conf` como volumen.

En el servidor de producción (host, no dentro del contenedor):

```bash
# Instalar rclone (si no está en el host)
sudo apt-get update && sudo apt-get install -y rclone

# Configurar rclone con el Service Account
rclone config create gdrive-backups drive \
  scope drive.file \
  service_account_file /srv/bodega/secrets/gdrive-service-account.json \
  --verbose
```

El archivo `rclone.conf` se guarda en `~/.config/rclone/rclone.conf`. El
contenedor `backup-scheduler` lo necesita accesible vía la variable
`RCLONE_CONFIG` (por defecto `/app/.config/rclone/rclone.conf` dentro del
contenedor). Montarlo como volumen en `docker-compose.yml` o copiarlo
manualmente al volumen `bodega-backups`.

### Probar la conexión

```bash
# Listar contenido de la raíz de gdrive-backups
# Debería mostrar la carpeta "bodega-backups"
rclone lsd gdrive-backups:/

# Listar archivos dentro de la carpeta de backups
# (puede estar vacía si es primera vez)
rclone ls gdrive-backups:bodega-backups/
```

### ¿Cómo funciona la autenticación internamente?

rclone usa el JSON del Service Account para:

1. **Firmar un JWT** usando la clave privada del JSON
2. **Enviar el JWT** a `https://oauth2.googleapis.com/token`
3. **Recibir un token de acceso** (válido por 1 hora)
4. **Usar ese token** para autenticar las llamadas a Drive API
5. **Renovar automáticamente** el token cuando expira

Este proceso es completamente automático — rclone lo maneja sin intervención.

---

## 8. Configurar variables de entorno

Agregar al `.env` de producción:

```env
# ── Respaldos ────────────────────────────────────────────────────────────────
# Destino en Google Drive (formato: <rclone_remote>:<ruta_en_drive>)
GDRIVE_BACKUPS_DEST=gdrive-backups:bodega-backups

# Directorio local de respaldos temporales
BACKUP_DIR=/srv/bodega/backups

# Ruta del volumen persistente de adjuntos (ya debería estar definida)
STORAGE_PATH=/srv/bodega/storage

# Días de retención de respaldos (por defecto 30)
RETENTION_DAYS=30
```

> **Nota:** No necesitas variables `RCLONE_CONFIG_*`. rclone guardó su
> configuración en `~/.config/rclone/rclone.conf` al ejecutar `config create`.
> El orquestador de backups respalda este archivo automáticamente.

---

## 9. Verificar funcionamiento

**En desarrollo** (sin Docker, sin Google Drive):

```bash
bash scripts/dev-backup-test.sh
```

**En producción** (con Docker y Google Drive):

```bash
# Ejecutar backup manual desde el contenedor
docker compose exec app bash /app/scripts/backup-orchestrator.sh

# O activar el scheduler automático
docker compose --profile backup up -d backup-scheduler

# Verificar que el backup aparece en Drive
rclone ls gdrive-backups:bodega-backups/$(date +%F)/

# Verificar el manifest
rclone cat gdrive-backups:bodega-backups/$(date +%F)/manifest.json | jq .

# Monitorear salud del backup desde el panel admin
curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/cron/backup-health
```

---

## Resumen de secretos a proteger

| Secreto | Ruta en servidor | ¿Respaldado? | Copia offline |
|---|---|---|---|
| JSON del Service Account | `/srv/bodega/secrets/gdrive-service-account.json` | ✅ En `env-config.tar.gz` | Password manager + caja fuerte |
| `AUTH_SECRET` | `.env` | ✅ En `env-config.tar.gz` | Password manager |
| `PREVENTION_DATA_ENCRYPTION_KEY` | Password manager (NO en .env respaldado) | ❌ Excluido del backup | Password manager |

> ⚠️ **Sin el JSON del Service Account no se pueden restaurar backups desde
> Google Drive.** Aunque el orquestador lo respalda automáticamente dentro de
> `env-config.tar.gz`, siempre guarda una copia independiente en un lugar
> seguro por si el backup completo se pierde.

---

## Solución de problemas

### "rclone: failed to find a satisfactory config"

El Service Account JSON no es válido o está corrupto. Verifica:
```bash
cat /srv/bodega/secrets/gdrive-service-account.json | jq .private_key
# Debe mostrar una clave privada RSA que empiece con "-----BEGIN PRIVATE KEY-----"
```

### "rclone: authentication failed"

El token de acceso expiró y rclone no pudo renovarlo. Normalmente es temporal.
Vuelve a intentar. Si persiste, verifica que el Service Account JSON no haya
expirado (los SA keys no expiran a menos que los rotes manualmente).

### "rclone: directory not found"

La carpeta `bodega-backups` no existe en Drive o no está compartida con el
Service Account. Verifica:
```bash
# ¿Existe la carpeta?
rclone lsd gdrive-backups:/

# Si no aparece, créala manualmente (paso 6)
```

### "rclone: insufficient permissions"

El Service Account no tiene permisos suficientes en la carpeta. Verifica que
hayas compartido la carpeta con **permiso de Editor**, no solo Lector.

---

## Referencias

- [Documentación oficial: Cuentas de servicio (Google)](https://developers.google.com/identity/protocols/oauth2/serviceaccount)
- [Documentación oficial: OAuth 2.0 Scopes para Drive](https://developers.google.com/drive/api/guides/api-specific-auth)
- [rclone: Google Drive](https://rclone.org/drive/)
- [Flujo de autenticación: JWT → token de acceso](https://developers.google.com/identity/protocols/oauth2/serviceaccount#authorizingrequests)
