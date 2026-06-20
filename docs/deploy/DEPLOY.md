# Despliegue — Chome Solicitudes y Bodega

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
| `NEXTAUTH_URL` | URL base de la app (para Origin check) | `https://bodega.chome.dev` |
| `STORAGE_PATH` | Ruta absoluta del volumen persistente para adjuntos | `/srv/bodega/storage` |

### SMTP (opcional pero recomendado)

| Variable | Default | Descripción |
|---|---|---|
| `SMTP_HOST` | — | Host del servidor de correo |
| `SMTP_PORT` | 587 | Puerto SMTP |
| `SMTP_USER` | — | Usuario de autenticación |
| `SMTP_PASS` | — | Contraseña de autenticación |
| `SMTP_FROM` | = `SMTP_USER` | Remitente de correos |
| `SMTP_SECURE` | `port === 465` | Forzar TLS implícito |
| `SMTP_DISABLED` | `false` | Desactiva envío de correo |

### Seed (solo para bootstrap inicial)

| Variable | Default | Descripción |
|---|---|---|
| `SEED_ADMIN_PASSWORD` | — | Password del admin seed |
| `SEED_ALLOW_DEFAULT_PASSWORD` | `false` | Permite el password por defecto en producción. **No usar.** |
| `SEED_DRY_RUN` | `false` | Valida entradas sin escribir (A-16) |

### Fail-fast

La app lanza un error al arrancar si `DATABASE_URL` no está definida
(`db/index.ts`). El pool usa `connect_timeout=10s` para fallar rápido ante una
BD que no responde.

---

## Docker (producción)

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
  -e NEXTAUTH_URL=https://bodega.chome.dev \
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
  → [deploy] (comentado — configurable por plataforma)
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

| Job | Descripción | Frecuencia recomendada |
|---|---|---|
| `cleanupOldNotifications(90)` | Limpia notificaciones leídas > 90 días | Diaria / semanal |
| `cleanupRateLimits()` | Limpia locks expirados y contadores stale | Diaria |

Ejecutar vía cron del sistema o herramienta de orquestación.

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
      - NEXTAUTH_URL=https://bodega.chome.dev
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
