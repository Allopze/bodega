# Despliegue — Chome Solicitudes y Bodega

Requisitos y guía para desplegar la aplicación en producción.

## Requisitos previos

- **Node.js** ≥ 20
- **PostgreSQL** ≥ 15
- **Volumen persistente** para adjuntos (`STORAGE_PATH`)

## Variables de entorno obligatorias

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | URL de conexión a PostgreSQL (ej: `postgres://user:pass@host:5432/chome`) |
| `AUTH_SECRET` | Secreto para Auth.js/NextAuth (generar con `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | URL base de la app (ej: `https://bodega.chome.dev`) |
| `STORAGE_PATH` | Ruta absoluta del volumen persistente para adjuntos |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Configuración de correo para notificaciones |
| `SEED_ADMIN_PASSWORD` | Password del admin seed (solo para bootstrap inicial) |

## Build y start

```bash
npm ci
npm run build
npm run start
```

Next.js inicia en el puerto 3000 por defecto.

## Migraciones de base de datos

```bash
npx drizzle-kit push        # push schema a la DB
# o
npx drizzle-kit migrate     # aplicar migraciones desde db/migrations/
```

Las migraciones están en `db/migrations/`. Ejecutarlas antes del primer start.

## Storage persistente

La app almacena adjuntos (facturas, cotizaciones, entregas) en el filesystem local bajo `STORAGE_PATH`. Si `STORAGE_PATH` no está definido, usa `./storage` relativo al working directory.

**En producción:** montar un volumen persistente en la ruta indicada por `STORAGE_PATH`. Los adjuntos son irrecuperables si se pierde el volumen.

Estructura de storage:
```
storage/
├── deliveries/          # Entregas de EPP
├── purchase-orders/     # Facturas de proveedor
├── repuestos/           # Cotizaciones de repuestos
└── servicios/           # Cotizaciones de servicios
```

## Docker (referencia)

No hay Dockerfile oficial. Para containerizar:

1. Build stage: `npm ci && npm run build`
2. Runtime stage: copiar `.next/standalone`, `public/`, `node_modules/`
3. Agregar `output: "standalone"` en `next.config.ts` para optimizar el container
4. Montar volumen en `STORAGE_PATH`
5. Ejecutar migraciones antes del primer start
6. Exponer puerto 3000

## Healthcheck

```bash
curl -f http://localhost:3000/api/health || exit 1
```

(Endpoint de healthcheck no implementado actualmente — considerar agregarlo.)

## Cron jobs

- `cleanupOldNotifications(90)` — limpiar notificaciones leídas mayores a 90 días
- `cleanupRateLimits()` — limpiar locks expirados y contadores stale

Ejecutar periódicamente (diario/semanal) vía cron del sistema o herramienta de orquestación.

## Notas de seguridad

- `AUTH_SECRET` y `SEED_ADMIN_PASSWORD` son sensibles — nunca commitear valores reales
- `.env.example` no contiene valores reales
- `npm audit --omit=dev` reporta 0 vulnerabilidades
- CSP configurado en `proxy.ts`, headers de seguridad en `next.config.ts`
