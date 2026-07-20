# Despliegue — Plataforma Chome

Guía completa para desplegar la aplicación en producción.

---

## Requisitos previos

- **Node.js** ≥ 20
- **PostgreSQL** ≥ 15
- **Volumen persistente** para adjuntos (`STORAGE_PATH`)
- **Docker** ≥ 24 (para despliegue en contenedor)

---

## Variables de entorno

### Obligatorias

| Variable | Descripción | Ejemplo |
|---|---|---|
| `DATABASE_URL` | URL de conexión a PostgreSQL | `postgres://user:pass@host:5432/bodega` |
| `AUTH_SECRET` | Secreto para firmar JWTs (`openssl rand -base64 32`) | — |
| `AUTH_URL` | URL publica base de la app | `https://bodega.chome.dev` |
| `STORAGE_PATH` | Ruta absoluta del volumen persistente para adjuntos | `/srv/bodega/storage` |

`APP_URL` o `NEXTAUTH_URL` tambien son aceptadas por partes del runtime, pero
Docker Compose exige `AUTH_URL`.

### Correo con Resend (opcional pero recomendado)

| Variable | Default | Descripción |
|---|---|---|
| `RESEND_API_KEY` | — | API key de Resend para invitaciones, recuperación y notificaciones por correo |

El interruptor global de correos vive en la configuracion del sistema. Sin
`RESEND_API_KEY`, los envios quedan como no-op y la app sigue arrancando.

### Seed (maestros base)

| Variable | Default | Descripción |
|---|---|---|
| `SEED_DRY_RUN` | `false` | Valida trabajadores y catálogo EPP sin escribir |

### Fail-fast

La app lanza un error al arrancar si `DATABASE_URL` no está definida
(`db/index.ts`). El pool usa `connect_timeout=10s` para fallar rápido ante una
BD que no responde.

---

## Docker (producción)

Para un servidor propio/casero, usar la guía operativa paso a paso:
[SERVIDOR_CASERO.md](SERVIDOR_CASERO.md). Ese flujo usa imágenes
preconstruidas, migraciones antes del rollout, `up -d --no-deps app`,
healthcheck y rollback.

### Dockerfile

El proyecto incluye un Dockerfile multi-stage con tres targets:

```
dev     → entorno de desarrollo con hot reload
prod    → imagen de producción standalone (la que se deploya)
build   → helper que ejecuta npm run build
```

### Build y push (producción)

```bash
# Build la imagen de producción
docker build --target prod -t bodega:latest .

# Ejecutar con variables de entorno
docker run -d --name bodega \
  -e DATABASE_URL=postgres://user:pass@host:5432/bodega \
  -e AUTH_SECRET=$(openssl rand -base64 32) \
  -e AUTH_URL=https://bodega.chome.dev \
  -e RESEND_API_KEY=re_... \
  -e STORAGE_PATH=/app/storage \
  -v bodega-storage:/app/storage \
  -p 3000:3000 \
  bodega:latest
```

### Detalles de la imagen de producción

1. **Base:** `node:20-alpine` con `wget` para healthcheck
2. **Output:** `output: "standalone"` (Next.js genera un bundle autónomo)
3. **Archivos copiados:** `.next/standalone`, `.next/static`, `public/`, `db/migrations/`, `db/seed/`
4. **Usuario:** `nextjs:nodejs` (UID 1001) — no ejecuta como root
5. **Storage:** `/app/storage` se crea al build y se monta como volumen
6. **Healthcheck:** `wget -qO- http://127.0.0.1:3000/api/health` cada 30s, timeout 5s, 3 reintentos

---

## Migraciones de base de datos

```bash
# Aplicar migraciones (idempotente)
npm run db:migrate
# Equivalente a: drizzle-kit migrate
```

Las migraciones están en `db/migrations/` y se aplican en orden alfabético.

### Despliegue CI/CD

El workflow `deploy.yml` ejecuta migraciones **antes** del rollout del contenedor:

```
push to main
  → build-and-push (Docker image → GHCR)
  → migrate (aplica drizzle-kit migrate contra PRODUCTION_DATABASE_URL)
  → deploy (SSH al servidor, reinicia app y valida healthcheck)
```

La migración corre como un job separado con `environment: production` (requiere
approval manual en GitHub Actions si está configurado).

---

## CI/CD pipeline

### CI (`ci.yml` — pull requests y pushes a main)

| Paso | Qué verifica |
|---|---|
| `typecheck` | Errores de tipos TypeScript |
| `lint` | ESLint |
| `test:coverage` | Unit tests con umbral de cobertura |
| `concurrency-postgres` | Tests de concurrencia contra PostgreSQL real |
| `build` | Build de Next.js completo |
| `e2e` | Playwright: admin-flow, purchase-flow, accessibility |
| `docker-smoke` | Build de imagen prod + verifica que arranca (no crashea) |

### Deploy (`deploy.yml` — push a main)

| Job | Qué hace |
|---|---|
| `build-and-push` | Build imagen Docker `prod` → push a `ghcr.io` |
| `migrate` | `drizzle-kit migrate` contra la DB de producción |
| `deploy` | SSH al VPS → `docker compose pull` → `docker compose up -d` → healthcheck |

### GitHub Secrets requeridos para deploy

| Secret | Descripción | Ejemplo |
|---|---|---|
| `PRODUCTION_DATABASE_URL` | URL de conexión a la DB de producción | `postgres://user:pass@host:5432/bodega` |
| `DEPLOY_HOST` | IP o hostname del VPS | `203.0.113.42` |
| `DEPLOY_USER` | Usuario SSH del VPS | `deploy` |
| `DEPLOY_SSH_KEY` | Clave SSH privada para conexión | `(contenido de ~/.ssh/id_ed25519)` |
| `DEPLOY_PATH` | Ruta del proyecto en el VPS (opcional) | `/srv/bodega` |

---

## Healthcheck

```bash
curl -f http://localhost:3000/api/health || exit 1
```

- **Público** (no requiere auth)
- Verifica conectividad con PostgreSQL via `SELECT 1`
- Responde `200 {"status":"ok","db":"connected"}` o `503 {"status":"error","db":"disconnected"}`
- El Dockerfile incluye `HEALTHCHECK` que sondea este endpoint automáticamente
- Un contenedor sin BD válida queda *unhealthy* en vez de servir tráfico roto

---

## Storage persistente

La app almacena adjuntos (facturas, cotizaciones, entregas, actas) en el
filesystem local bajo `STORAGE_PATH`. Si `STORAGE_PATH` no está definido, usa
`./storage` relativo al working directory.

**En producción:** montar un volumen persistente. Los adjuntos son
irrecuperables si se pierde el volumen.

Estructura:
```
storage/
├── deliveries/          # Comprobantes de entrega de EPP
├── purchase-orders/     # Facturas de proveedor
├── repuestos/           # Cotizaciones de repuestos
├── servicios/           # Cotizaciones de servicios
└── prevencion/          # Actas y documentos SST
```

---

## Cron jobs

| Job | Descripción | Cómo se ejecuta |
|---|---|---|
| `backup-scheduler` | Orquesta backup completo (PG + storage + config) + subida a Google Drive | Servicio Docker (`docker compose --profile backup up -d`) |
| `/api/cron/backup-health` | Verifica edad del último backup (<36h) | Cron externo (UptimeRobot, healthchecks.io, o Vercel Cron) |
| `cleanupOldNotifications(90)` | Limpia notificaciones leídas > 90 días | TBD — endpoint `/api/cron/*` o servicio Docker |
| `cleanupRateLimits()` | Limpia locks expirados y contadores stale | TBD — endpoint `/api/cron/*` o servicio Docker |

El backup-scheduler corre diariamente a las `BACKUP_HOUR` UTC (default: 3 AM)
y reporta al endpoint `/api/cron/backup-health` después de cada ejecución.

### Probar backups en desarrollo

```bash
bash scripts/dev-backup-test.sh
```

Ciclo completo de backup → validación de estructura → restore a `bodega_e2e`
con verificación de conteo de tablas. No requiere Docker ni Google Drive.

---

## Seguridad en producción

### Headers de seguridad

Configurados en `next.config.ts` y aplicados a todas las rutas:

| Header | Valor |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |

### Autenticación

- **NextAuth v5** con proveedor Credentials (email + password)
- JWT firmado con `AUTH_SECRET` (≥ 32 bytes)
- Cookie: `httpOnly; Secure; SameSite=Lax`
- Permisos se re-leen de la DB en cada request (`getUserRbacById, bypassCache=true`)
- Usuario inactivo → token nulo → sesión invalidada

### CSRF

Todas las mutaciones pasan por Server Actions (protección CSRF nativa de
Next.js). Ver [CSRF.md](../security/CSRF.md).

### Rate limiting

- Login y registro: 5 intentos / 15 min por IP + email
- Implementado con `INSERT...ON CONFLICT DO UPDATE` atómico en PostgreSQL
- **Importante:** el proxy frontal (NGINX, Traefik, Cloudflare) debe
  sobrescribir `X-Forwarded-For` con la IP real del cliente

### Subida de archivos

- Magic bytes validados server-side (PDF, JPEG, PNG, XML)
- MIME normalizado independientemente del Content-Type declarado por el cliente
- Tamaño máximo configurable via `PDF_MAX_SIZE_MB`

### Auditoría

Todas las mutaciones de datos escriben entradas en `audit_log` con `userId`,
`action`, `entityId`, timestamp y estado anterior/nuevo.

### Configuración de Reverse Proxy

En entornos de producción, la aplicación debe desplegarse detrás de un reverse proxy (como NGINX, Traefik o Cloudflare). Para garantizar el funcionamiento correcto de la autenticación (`next-auth` / Auth.js) y del rate limiting por IP, el proxy debe propagar correctamente las cabeceras originales del cliente.

#### Requisitos clave:
1. **Propagación del Host**: Auth.js requiere que la cabecera `Host` original coincida con la URL canónica de la aplicación para evitar ataques de redirección no autorizados. En el archivo `lib/auth/auth.ts`, la propiedad `trustHost: true` está activada para habilitar este comportamiento.
2. **Propagación de IP**: El rate limiter (`lib/services/rate-limit.ts`) obtiene la IP del cliente leyendo la cabecera `X-Forwarded-For`. El proxy debe configurar esta cabecera con la IP real del cliente y no la del propio proxy.
3. **Validación de `AUTH_URL`**: Asegúrese de definir la variable de entorno `AUTH_URL` (o `NEXTAUTH_URL` / `APP_URL`) apuntando a la URL pública y protocolo correctos (por ejemplo, `https://bodega.chome.dev`).

#### Ejemplo de configuración para NGINX:

```nginx
server {
    listen 443 ssl http2;
    server_name bodega.chome.dev;

    # Configuración de SSL ...

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Soporte para WebSockets (opcional/dev)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;

        # Cabeceras de Host (Crítico para NextAuth/Auth.js)
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        # Cabeceras de IP (Crítico para Rate Limiting)
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Configuración con Cloudflare:
Si la aplicación se encuentra detrás de Cloudflare, asegúrese de que la cabecera `CF-Connecting-IP` o `X-Forwarded-For` sea respetada. La aplicación lee la primera IP del listado en `X-Forwarded-For`.

---

## Plataformas de despliegue

### Docker Compose (self-hosted)

```yaml
version: "3.8"
services:
  app:
    build:
      context: .
      target: prod
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/bodega
      - AUTH_SECRET=${AUTH_SECRET}
      - AUTH_URL=https://bodega.chome.dev
      - RESEND_API_KEY=${RESEND_API_KEY}
      - STORAGE_PATH=/app/storage
    volumes:
      - storage:/app/storage
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: bodega
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d bodega"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  storage:
  pgdata:
```

### Vercel

- `output: "standalone"` ya está configurado
- Las migraciones se ejecutan via GitHub Actions (no Vercel build)
- `STORAGE_PATH` requiere volumen externo (no disponible en Vercel Serverless)

### Fly.io / Railway / Render

- Usar el Dockerfile con target `prod`
- Montar volumen persistente en `STORAGE_PATH`
- Configurar `PRODUCTION_DATABASE_URL` como secret
- Ejecutar migraciones como step de deploy

---

## Troubleshooting

| Problema | Causa | Solución |
|---|---|---|
| 500 en todas las queries | DB no responde | Verificar `DATABASE_URL` y que PG esté corriendo |
| `Unauthorized` en Server Actions | Cookie expirada / `AUTH_SECRET` cambió | Regenerar sesión; si rotaste el secret, los usuarios deben re-login |
| Adjuntos 404 | `STORAGE_PATH` no montado como volumen | Verificar que el volumen persistente está montado |
| Rate limit no funciona | Proxy no sobrescribe `X-Forwarded-For` | Configurar proxy para fijar IP real |
| Migración falla | Schema desincronizado | Ejecutar `drizzle-kit migrate` manualmente |
| Contenedor unhealthy | BD no accesible desde el contenedor | Verificar networking y credenciales de DB |
