# Runbook de Recuperación Catastrófica

**Plataforma:** Chome

**Última actualización:** Julio 2026

---

## Escenario

El servidor de producción se perdió totalmente por:

- 🔥 Fuego / desastre físico en el datacenter
- 💻 Ransomware que cifró todos los datos
- ☁️ Proveedor cloud eliminó la instancia
- 💥 Corrupción irreversible del filesystem

**PRE-REQUISITO:** Tener acceso a:

1. ✅ Cuenta Gmail dedicada para backups (`chome-backups@gmail.com`)
2. ✅ JSON del Service Account guardado en password manager
3. ✅ Código fuente en GitHub (`allopze/bodega`)
4. ✅ Acceso a GitHub Container Registry
5. ✅ Credenciales de producción (`AUTH_SECRET`, `PREVENTION_DATA_ENCRYPTION_KEY`,
      `CRON_SECRET`, etc.) guardadas en password manager corporativo

---

## Tiempo estimado

| Paso | Tiempo |
|---|---|
| Aprovisionar servidor nuevo | 30 min |
| Instalar dependencias | 15 min |
| Descargar y verificar backup | 20 min |
| Restaurar PostgreSQL | 30–60 min (depende del tamaño) |
| Restaurar storage | 15 min |
| Iniciar app y validar | 10 min |
| **Total** | **~2 horas** |

---

## Diagrama de flujo

```text
Inicio
  │
  ├─ 1. ¿Tienes el JSON del Service Account?
  │     NO → Buscar en password manager o copia offline → si no está: DETENERSE
  │     SÍ  → Continuar
  │
  ├─ 2. Aprovisionar servidor nuevo (Ubuntu 22.04+)
  │
  ├─ 3. ¿Servidor nuevo (sin Docker ni nada)?
  │     SÍ → Usar restore catastrófico automático
  │     │     └─ scripts/catastrophic-restore.sh
  │     NO → ¿Servidor existente con Docker funcionando?
  │           └─ Usar restore-all.sh (más rápido, no instala nada)
  │
  ├─ 4. ¿Restore funcionó?
  │     SÍ  → Ir a validación
  │     NO  → Restore manual (paso 3)
  │
  └─ 5. Validar y reanudar operaciones
```

---

## Paso 1: Aprovisionar servidor nuevo

```bash
# Contratar VPS (DigitalOcean/Linode/Hetzner):
#   - CPU: 2+ cores
#   - RAM: 4+ GB
#   - Disco: 40+ GB SSD
#   - SO: Ubuntu 22.04 LTS

# Conectarse por SSH
ssh root@<nueva-ip>

# Actualizar sistema
apt-get update && apt-get upgrade -y
```

---

## Paso 2: Restauración automática (recomendado)

Necesitas dos archivos locales: el JSON del Service Account y el script de
restore catastrófico (desde tu checkout local del repo).

```bash
# 1. Subir el JSON del SA y el script de restore
scp gdrive-service-account.json \
    scripts/catastrophic-restore.sh \
    root@<nueva-ip>:/tmp/

# 2. Conectarse al servidor y ejecutar
ssh root@<nueva-ip>
bash /tmp/catastrophic-restore.sh \
  --service-account-json /tmp/gdrive-service-account.json \
  --date latest
```

El script instala todo: Docker, Node.js, rclone, descarga el backup,
verifica checksums, restaura configuración, storage, **restaura PostgreSQL
automáticamente** (inicia el contenedor db, ejecuta pg_restore, aplica
migraciones Drizzle e inicia la app).

> ⚠️ Si el restore automático falla, ve al Paso 3 (restauración manual).

### Alternativa: restore-all.sh (servidor con Docker ya funcionando)

Si el servidor **ya tiene Docker y rclone** configurados (ej: migración a
servidor nuevo pero con las herramientas ya instaladas), usa `restore-all.sh`
que es más rápido por que no instala dependencias:

```bash
# Descargar backup y restaurar todo
sudo bash /srv/bodega/scripts/restore-all.sh

# Opciones:
#   --verify-only    Solo verificar integridad, no restaurar
#   --skip-pg        No restaurar PostgreSQL
#   --skip-storage   No restaurar storage
#   --dry-run        Mostrar lo que se haría sin ejecutar
```

Este script asume que Docker, docker-compose.yml y rclone ya existen.

### Si no tienes acceso al checkout local

```bash
# Descargar solo el script de restore desde GitHub
wget -O /tmp/catastrophic-restore.sh \
  https://raw.githubusercontent.com/allopze/bodega/main/scripts/catastrophic-restore.sh
chmod +x /tmp/catastrophic-restore.sh

# (requiere subir el SA JSON por separado, ej: scp o copiar desde password manager)
bash /tmp/catastrophic-restore.sh \
  --service-account-json /tmp/gdrive-service-account.json \
  --date latest
```

---

## Paso 3: Restauración manual (si el automático falla)

### 3.1 Instalar dependencias

```bash
# Docker
curl -fsSL https://get.docker.com | bash
usermod -aG docker $USER

# rclone
apt-get install -y rclone jq postgresql-client

# Configurar rclone
rclone config create gdrive-backups drive \
  scope drive.file \
  service_account_file /ruta/al/sa.json
```

### 3.2 Descargar backup

```bash
# Ver backups disponibles
rclone lsd gdrive-backups:bodega-backups/

# Descargar el más reciente
mkdir -p /srv/bodega/restore
rclone copy gdrive-backups:bodega-backups/latest/ /srv/bodega/restore/ --verbose --checksum
```

### 3.3 Verificar integridad

```bash
cd /srv/bodega/restore

# Ver checksums del manifiesto
MANIFEST=manifest.json
PG_SHA=$(jq -r '.components.postgres.sha256' $MANIFEST)
ST_SHA=$(jq -r '.components.storage.sha256' $MANIFEST)
CF_SHA=$(jq -r '.components.config.sha256' $MANIFEST)

# Verificar cada uno
echo "$PG_SHA  postgres.dump" | sha256sum -c
echo "$ST_SHA  storage.tar.gz" | sha256sum -c
echo "$CF_SHA  env-config.tar.gz" | sha256sum -c
```

### 3.4 Restaurar configuración

```bash
mkdir -p /srv/bodega
tar -xzf /srv/bodega/restore/env-config.tar.gz -C /tmp/env-restore
cp /tmp/env-restore/.env /srv/bodega/.env 2>/dev/null || true
chmod 600 /srv/bodega/.env
```

### 3.5 Restaurar storage

```bash
STORAGE_PATH=$(grep -oP '^STORAGE_PATH=\K.*' /srv/bodega/.env 2>/dev/null || echo '/srv/bodega/storage')
mkdir -p "$STORAGE_PATH"
tar -xzf /srv/bodega/restore/storage.tar.gz -C "$(dirname "$STORAGE_PATH")"
chown -R 1001:1001 "$STORAGE_PATH"
```

### 3.6 Clonar repo y configurar Docker

```bash
cd /srv/bodega
git clone https://github.com/allopze/bodega /tmp/bodega-repo
cp /tmp/bodega-repo/docker-compose.yml .
cp -r /tmp/bodega-repo/scripts .
chmod +x scripts/*.sh
rm -rf /tmp/bodega-repo
```

### 3.7 Restaurar PostgreSQL

```bash
# Iniciar base de datos
docker compose up -d db

# Esperar a que esté lista
sleep 10
docker compose exec db pg_isready

# Crear usuario bodega si no existe (necesario en servidor nuevo)
docker compose exec db createuser -s bodega 2>/dev/null || true

# Leer DATABASE_URL del .env (solo línea activa, ignorando comentarios)
DATABASE_URL=$(grep -oP '^DATABASE_URL=\K.*' /srv/bodega/.env | head -1)

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL no encontrada en .env"
  exit 1
fi

# Restaurar desde el backup
pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname="$DATABASE_URL" \
  --verbose \
  /srv/bodega/restore/postgres.dump
```

### 3.8 Aplicar migraciones (si la app es más nueva que el backup)

```bash
# Si la versión de la app tiene migraciones que el backup no contempla,
# hay que aplicarlas antes de iniciar. Esto es idempotente.
docker compose run --rm migrate
```

### 3.9 Iniciar app

```bash
docker compose up -d app

# Verificar
sleep 5
curl -f http://localhost:3000/api/health
```

---

## Paso 4: Validación post-restauración

```bash
# 1. Healthcheck
curl http://localhost:3000/api/health

# 2. Verificar conteos críticos
psql "$DATABASE_URL" -c "SELECT count(*) FROM users;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM purchase_requests;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM purchase_orders;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM worksite_stock;"

# 3. Verificar storage (conteo de archivos)
find /srv/bodega/storage -type f | wc -l

# 4. Verificar que adjuntos se sirven (reemplazar CON_ID con un ID real)
# curl -I http://localhost:3000/api/attachments/CON_ID

# 5. Revisar logs
docker compose logs --tail=50 app

# 6. Probar login en la web
# 7. Verificar backups (activar el scheduler automático)
docker compose --profile backup up -d backup-scheduler
```

---

## Paso 5: Post-restauración

- [ ] Verificar que los usuarios pueden iniciar sesión
- [ ] Verificar que los attachments/adjuntos se sirven correctamente
- [ ] Verificar que el backup-scheduler está corriendo (`docker compose ps`)
- [ ] Ejecutar primer backup manual para asegurar continuidad
- [ ] Restaurar secrets faltantes desde password manager:
      (AUTH_SECRET, PREVENTION_DATA_ENCRYPTION_KEY, CRON_SECRET, COPEC_*)
- [ ] Notificar a los usuarios que el sistema está operativo
- [ ] Documentar hora de inicio y fin de la recuperación

---

## Checklist de preparación (hacer AHORA)

Para que este runbook funcione en una emergencia real,
**verifica mensualmente**:

- [ ] El JSON del Service Account está en el password manager
- [ ] La cuenta Gmail de backups tiene espacio disponible
- [ ] Los backups se están ejecutando (ver `/admin/backups`)
- [ ] Se puede acceder a GitHub para clonar el repo
- [ ] Las credenciales de GHCR son válidas
- [ ] Existe al menos un backup reciente en Google Drive
- [ ] Se ha probado la restauración en un entorno staging en los últimos 30 días

---

## Contactos de emergencia

| Rol | Persona | Teléfono |
|---|---|---|
| Administrador del sistema | | |
| DBA / Soporte PostgreSQL | | |
| Dueño de Service Account | | |
| Jefatura Chome | | |

---

## Métricas de recuperación

| Métrica | Objetivo | Real |
|---|---|---|
| RTO (Recovery Time Objective) | 4 horas | |
| RPO (Recovery Point Objective) | 24 horas | |
| Tiempo de restauración de backup | < 1 hora | |
| Tiempo de verificación de integridad | < 10 min | |
