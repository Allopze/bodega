# Deploy en Servidor Casero — Plataforma Chome

Guía operativa para actualizar la webapp en un servidor propio usando Docker
Compose e imágenes preconstruidas. Este flujo reemplaza el deploy manual con
ZIP, `docker compose down`, sobrescritura de archivos y `build --no-cache`.

---

## Objetivo

El servidor casero no debe compilar la app en cada deploy. Su trabajo ideal es:

1. Descargar una imagen Docker ya construida.
2. Ejecutar migraciones de base de datos.
3. Reemplazar solo el contenedor `app`.
4. Verificar `/api/health`.
5. Volver al tag anterior si algo falla.

Esto reduce downtime, hace rollback más simple y evita dejar `/server/plataforma`
en un estado intermedio si falla la compilación.

---

## Flujo recomendado

```text
GitHub/main
  → GitHub Actions construye imagen prod
  → Push a GHCR: ghcr.io/<usuario>/<repo>:<sha>
  → GitHub Actions corre migraciones contra PRODUCTION_DATABASE_URL
  → Servidor hace pull del tag
  → docker compose up -d --no-deps app
  → healthcheck
```

No usar en deploy normal:

```bash
docker compose down
docker compose build --no-cache
```

`down` detiene servicios que no necesitan reiniciarse y `--no-cache` fuerza una
compilación lenta en el servidor.

---

## Setup inicial del servidor

### 1. Crear carpeta estable

```bash
sudo mkdir -p /server/plataforma
sudo chown -R "$USER":"$USER" /server/plataforma
cd /server/plataforma
```

### 2. Copiar archivos mínimos

En el servidor deben quedar:

```text
/server/plataforma/
├── docker-compose.yml
└── .env
```

El `docker-compose.yml` debe venir del repo. No hagas cambios manuales en el
servidor; si hay que cambiar Compose, cámbialo en Git y vuelve a desplegar.

### 3. Crear `.env`

Ejemplo con Postgres incluido en `docker-compose.yml`:

```env
GITHUB_REPOSITORY=tuusuario/turepo
IMAGE_TAG=latest

POSTGRES_USER=bodega
POSTGRES_PASSWORD=CAMBIAR_POR_PASSWORD_SEGURA
POSTGRES_DB=bodega

AUTH_SECRET=CAMBIAR_POR_SECRETO_LARGO
AUTH_URL=https://plataforma.tudominio.cl

STORAGE_PATH=/data/storage
RESEND_API_KEY=
```

Generar `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Si usas una base de datos externa, agrega:

```env
DATABASE_URL=postgres://usuario:password@host:5432/bodega
```

### 4. Login a GHCR

Si el paquete de GitHub Container Registry es privado, crea un token de GitHub
con permiso para leer packages y ejecuta:

```bash
echo "GITHUB_TOKEN_CON_READ_PACKAGES" | docker login ghcr.io -u TU_USUARIO --password-stdin
```

---

## Primer arranque

```bash
cd /server/plataforma

docker compose pull app migrate
docker compose up -d db
docker compose run --rm migrate
docker compose run --rm seed
docker compose up -d app

curl -f http://localhost:3000/api/health
docker compose ps
```

Si `curl` responde `200`, la app está arriba y conectada a la base de datos.
El seed carga datos maestros base (faenas/trabajadores y catálogo EPP); el
primer usuario administrador se crea desde `/registro` cuando la base está
vacía.

---

## Deploy manual de una nueva versión

Usa el SHA/tag publicado por GitHub Actions:

```bash
cd /server/plataforma

export IMAGE_TAG=<sha-del-commit>

docker compose pull app migrate
docker compose run --rm migrate
docker compose up -d --no-deps app

curl -f http://localhost:3000/api/health
docker compose ps
```

Notas:

- `docker compose run --rm migrate` aplica migraciones y sale. Es idempotente.
- `docker compose up -d --no-deps app` reemplaza solo la app. No reinicia la DB.
- No uses `docker compose down` para actualizar la app.

---

## Deploy automático con GitHub Actions

El repo ya incluye `.github/workflows/deploy.yml`. Para usarlo, configura estos
secrets en GitHub:

| Secret | Valor |
|---|---|
| `PRODUCTION_DATABASE_URL` | URL de Postgres de producción |
| `DEPLOY_HOST` | IP o dominio del servidor casero |
| `DEPLOY_USER` | Usuario SSH |
| `DEPLOY_SSH_KEY` | Clave privada SSH para entrar al servidor |
| `DEPLOY_PATH` | `/server/plataforma` |

Con esto, un push a `main` ejecuta:

1. Build de imagen `prod`.
2. Push a `ghcr.io`.
3. Migraciones desde GitHub Actions contra `PRODUCTION_DATABASE_URL`.
4. Deploy por SSH en `DEPLOY_PATH`.
5. Healthcheck.
6. Rollback automático si falla.

Nota: el workflow trae default interno `/srv/bodega` si `DEPLOY_PATH` no está
definido. Para seguir esta guía, define `DEPLOY_PATH=/server/plataforma`.

---

## Rollback manual

Antes de desplegar, anota el tag actual:

```bash
cd /server/plataforma
docker compose images app
```

Si el nuevo deploy falla:

```bash
cd /server/plataforma

export IMAGE_TAG=<tag-anterior>

docker compose pull app
docker compose up -d --no-deps app
curl -f http://localhost:3000/api/health
```

Las migraciones normalmente son hacia adelante. Si una migración cambia datos o
schema de forma incompatible, el rollback de imagen puede requerir intervención
manual. Por eso el deploy automático corre migraciones antes y valida healthcheck.

---

## Logs y diagnóstico

Ver estado:

```bash
docker compose ps
```

Ver logs de app:

```bash
docker compose logs --tail=200 app
```

Ver logs de migración:

```bash
docker compose logs --tail=200 migrate
```

Healthcheck manual:

```bash
curl -f http://localhost:3000/api/health
```

---

## Limpieza segura

Para liberar espacio de imágenes antiguas:

```bash
docker image prune
```

No borres volúmenes sin backup:

```bash
docker volume ls
```

Los volúmenes `bodega-db` y `bodega-storage` contienen la base de datos y
adjuntos. Borrarlos equivale a perder producción.

---

## Si debes seguir con ZIP temporalmente

Usa directorios versionados y evita sobrescribir en caliente:

```bash
cd /server

mkdir -p releases/plataforma-YYYYMMDD-HHMM
unzip release.zip -d releases/plataforma-YYYYMMDD-HHMM

cd releases/plataforma-YYYYMMDD-HHMM
docker compose build app migrate
docker compose run --rm migrate

ln -sfn /server/releases/plataforma-YYYYMMDD-HHMM /server/plataforma
cd /server/plataforma

docker compose up -d --no-deps app
curl -f http://localhost:3000/api/health
```

Esto sigue siendo inferior al flujo con imágenes preconstruidas, pero es más
seguro que descomprimir encima de `/server/plataforma`.

---

## Checklist de deploy

- [ ] Imagen publicada en GHCR.
- [ ] `.env` de producción actualizado.
- [ ] Backup reciente de Postgres.
- [ ] Backup reciente de `storage`.
- [ ] `docker compose pull app migrate`.
- [ ] `docker compose run --rm migrate`.
- [ ] `docker compose up -d --no-deps app`.
- [ ] `curl -f http://localhost:3000/api/health`.
- [ ] Revisar `docker compose logs --tail=100 app`.
