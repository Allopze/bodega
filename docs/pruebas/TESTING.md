# Testing — Plataforma Chome

Este documento describe los tipos de prueba disponibles, cómo ejecutarlos y el
flujo completo para validar la aplicación.

---

## Índice

1. [Tipos de prueba](#1-tipos-de-prueba)
2. [Pruebas unitarias (vitest)](#2-pruebas-unitarias-vitest)
3. [Pruebas E2E (Playwright)](#3-pruebas-e2e-playwright)
4. [Capturas de pantallas de la app](#4-capturas-de-pantallas-de-la-app)
5. [Prueba manual siguiendo el flujo completo](#5-prueba-manual-siguiendo-el-flujo-completo)
6. [Cobertura](#6-cobertura)
7. [Resolución de problemas](#7-resolución-de-problemas)

---

## 1. Tipos de prueba

| Tipo | Herramienta | Alcance | Database |
|------|-------------|---------|----------|
| Unitarias | vitest | Lógica pura (transiciones de estado, permisos, totales, validaciones) | Ninguna (datos mock en memoria) |
| E2E | Playwright | Flujo completo desde el navegador (login → solicitud → aprobación → OC → factura → recepción) | Postgres desechable `bodega_e2e` |
| Capturas | Playwright + script local | PNG full-page de todas las pantallas navegables en desktop y mobile | Postgres desechable `bodega_capture` |
| Manual | Navegador + dev server | Exploración visual, casos borde no automatizados | Postgres local configurado en `.env.local` |

---

## 2. Pruebas unitarias (vitest)

### 2.1. Ejecución

```bash
# Todas las pruebas unitarias
npm test

# Modo watch (para desarrollo)
npm run test:watch

# Con cobertura
npm run test:coverage
```

### 2.2. Archivos de prueba

```
lib/__tests__/
├── auth-can.test.ts              # Permisos RBAC: can(), hasRole(), canAccessWorksite()
├── auth-rbac.test.ts             # Reglas RBAC: rol vs permisos
├── item-state.test.ts            # Máquina de estados: transiciones válidas/inválidas
├── order-totals.test.ts          # Cálculo de totales de OC (neto, IVA 19%, total)
├── postpone-item-action.test.ts  # Validaciones de postponeItemAction (23 tests)
└── report-export.test.ts         # Generación de reportes Excel
```

### 2.3. Qué prueban

| Archivo | Sujeto | Dependencias externas |
|---------|--------|-----------------------|
| `auth-can.test.ts` | `lib/auth/can.ts` | next-auth (mockeado) |
| `auth-rbac.test.ts` | Reglas de negocio RBAC | Ninguna |
| `item-state.test.ts` | `canTransition()`, `ALLOWED_TRANSITIONS` | Ninguna |
| `order-totals.test.ts` | `computeOrderTotals()` | Ninguna |
| `postpone-item-action.test.ts` | `postponeItemAction()` (server action) | next-auth + DB (mockeados) |
| `report-export.test.ts` | Exportación Excel | DB mockeada |

### 2.4. Agregar una prueba unitaria nueva

1. Crea el archivo en `lib/__tests__/` con la convención `mi-modulo.test.ts`.
2. Para pruebas de lógica pura, no necesitas mocks.
3. Para pruebas que dependen de `next-auth`, mockea el módulo `@/lib/auth/auth`.
4. Para pruebas que dependen de la DB, mockea `@/db` (ver `postpone-item-action.test.ts` como referencia).
5. Ejecuta `npm test` para verificar.

---

## 3. Pruebas E2E (Playwright)

### 3.1. Requisitos

- Tener el proyecto construido (`npm run build` o que `start-server.sh` lo haga automáticamente).
- Tener Postgres local accesible con la misma configuración de `.env.local` (`PGHOST`, usuario, etc.).
- Puerto 3100 libre (configurable vía `E2E_PORT`).

### 3.2. Ejecución

```bash
# Una vez (construye + inicia servidor + ejecuta tests)
npm run test:e2e

# Con UI interactiva de Playwright
npm run test:e2e:ui
```

El servidor se inicia automáticamente gracias al bloque `webServer` en
`playwright.config.ts`. No necesitas iniciar nada manualmente.

### 3.3. ¿Qué hacen?

La suite Playwright cubre los flujos principales y algunos bordes operativos:

| Test | Descripción |
|------|-------------|
| `e2e/admin-flow.spec.ts` | Usuarios/admin: invitaciones, sesión y pantallas administrativas críticas. |
| `e2e/purchase-flow.spec.ts` | Solicitud → aprobación/rechazo → OC → emisión/envío → recepción en oficina/faena → trazabilidad → export Excel desde API y descarga real. |
| `e2e/worker-delivery-flow.spec.ts` | Entregas de EPP: sobrecantidad bloqueada, comprobante inválido rechazado, comprobante PDF descargable y entrega nominal. |
| `e2e/export-volume.spec.ts` | Export Excel parseable con dataset operativo bulk de 120 ítems sin OC. |

### 3.4. Base de datos E2E

Playwright usa una base de datos Postgres **independiente y efímera**:

```
postgres:///bodega_e2e
```

Se crea si falta y se resetea desde cero con `e2e/setup-db.ts` cada vez que se ejecutan los tests.
El reset destructivo solo corre si la URL apunta a una base con marcador desechable
(`_test`, `_e2e`, `_capture`, `_tmp` o `_temp`) y si la variable de autorización está activa.
`playwright.config.ts` define `E2E_ALLOW_DESTRUCTIVE_RESET=true` para el flujo automatizado.
Contiene datos semilla fijos:

| Dato | Valor |
|------|-------|
| Admin | `admin@e2e.chome.cl` / `chome2026` |
| Faena | Faena E2E |
| Centro de costo | Centro E2E |
| Proveedor | Proveedor E2E |
| Producto | Guante E2E (SKU: E2E-001) |
| EPP | Casco EPP E2E |
| Bulk export | 120 solicitudes/items aprobados `SOL-BULK-E2E-*` para validar Excel con volumen |

### 3.5. Arquitectura

```
playwright.config.ts
  └── webServer → e2e/start-server.sh
                    ├── npm run e2e:setup   (corre setup-db.ts)
                    ├── npm run build       (next build)
                    └── next start --port 3100
```

Cada ejecución E2E:
1. Valida que la URL Postgres sea desechable y que el reset esté explícitamente autorizado
2. Crea `bodega_e2e` si falta, resetea su schema `public` y aplica migraciones/fixtures
3. Construye la app con `next build`
4. Inicia el servidor en el puerto 3100
5. Playwright ejecuta los tests contra `http://localhost:3100`
6. Al terminar, Playwright detiene el servidor automáticamente

### 3.6. Debugging E2E

```bash
# Tests en modo debug (pausa en cada paso)
npx playwright test --debug

# Ver reporte HTML después de la ejecución
npx playwright show-report

# Ejecutar un test específico por nombre
npx playwright test -g "descarga real de Excel"

# Ejecutar solo las coberturas agregadas de auditoría
npm run test:e2e -- e2e/worker-delivery-flow.spec.ts
npm run test:e2e -- e2e/export-volume.spec.ts
```

Playwright captura trace y video automáticamente en caso de falla.

---

## 4. Capturas de pantallas de la app

El script `scripts/capture-all-routes.ts` genera capturas PNG full-page de las
pantallas navegables de la app en dos viewports:

- Desktop: 1920 × 1080
- Mobile: 390 × 844

También escribe un `manifest.json` con rutas, URLs finales, estado HTTP y ruta
de cada PNG generado.

### 4.1. Requisitos

- Tener dependencias instaladas (`npm install`).
- Tener Postgres local accesible con la configuración de usuario/host del entorno.
- Tener el build de producción generado.
- Usar una base de datos **desechable** cuyo nombre contenga `_capture`,
  `_test`, `_e2e`, `_tmp` o `_temp`.

No uses `DATABASE_URL` de desarrollo/producción para capturas. El script resetea
la base indicada por `CAPTURE_DATABASE_URL`.

### 4.2. Ejecución

```bash
npm run build
CAPTURE_DATABASE_URL=postgres:///bodega_capture CAPTURE_ALLOW_DESTRUCTIVE_RESET=true npx tsx scripts/capture-all-routes.ts
```

Si necesitas otro puerto:

```bash
CAPTURE_PORT=3130 CAPTURE_DATABASE_URL=postgres:///bodega_capture CAPTURE_ALLOW_DESTRUCTIVE_RESET=true npx tsx scripts/capture-all-routes.ts
```

### 4.3. Salida

Los archivos se escriben en:

```text
audit/screenshots/2026-06-09-playwright/
```

Incluye:

- `desktop-*.png`
- `mobile-*.png`
- `manifest.json`

El script levanta la app en `http://127.0.0.1:3127`, crea datos de auditoría,
inicia sesión con el usuario interno de capturas y recorre las rutas definidas
en el inventario del propio script.

La base `bodega_capture` se resetea y queda sembrada con datos mock
representativos para todos los apartados navegables: dashboard, solicitudes,
aprobaciones, compras, recepción, bodega, entregas, trazabilidad, reportes,
repuestos, servicios, administración, auditoría, configuración y
notificaciones. El `manifest.json` incluye `seedCoverage`, que declara qué
fixtures alimentan cada sección.

### 4.4. Validación rápida

```bash
node - <<'NODE'
const fs = require("fs")
const path = require("path")
const manifest = JSON.parse(fs.readFileSync("audit/screenshots/2026-06-09-playwright/manifest.json", "utf8"))
const failures = manifest.results.filter((result) => !result.ok)
const missing = manifest.results.filter((result) => !fs.existsSync(path.join(process.cwd(), result.screenshot)))
const zero = manifest.results.filter((result) => fs.existsSync(path.join(process.cwd(), result.screenshot)) && fs.statSync(path.join(process.cwd(), result.screenshot)).size === 0)
console.log({
  routes: manifest.routes.length,
  results: manifest.results.length,
  failures: failures.length,
  missing: missing.length,
  zero: zero.length,
  seedSections: manifest.seedCoverage?.length ?? 0,
})
NODE
```

Una ejecución sana debe dejar `failures: 0`, `missing: 0`, `zero: 0` y
`seedSections` mayor que cero.

Para revisar conteos directos en la DB sembrada:

```bash
CAPTURE_DATABASE_URL=postgres:///bodega_capture PGHOST=/var/run/postgresql npx tsx - <<'TS'
import postgres from "postgres"

const databaseUrl = process.env.CAPTURE_DATABASE_URL
if (!databaseUrl) throw new Error("CAPTURE_DATABASE_URL is required")

const sql = postgres(databaseUrl, { max: 1 })
const tables = [
  "users",
  "roles",
  "worksites",
  "suppliers",
  "workers",
  "products",
  "purchase_requests",
  "purchase_request_items",
  "purchase_orders",
  "purchase_order_invoices",
  "receipts",
  "worksite_stock",
  "inventory_movements",
  "deliveries",
  "audit_log",
  "notifications",
  "system_settings",
  "repuesto_quotations",
  "service_quotations",
]

for (const table of tables) {
  const rows = await sql.unsafe(`select count(*)::int as n from ${table}`)
  console.log(`${table}: ${rows[0].n}`)
}

await sql.end()
TS
```

### 4.5. Cobertura del inventario de rutas

El inventario de capturas está protegido por una prueba unitaria:

```bash
npx vitest run scripts/capture-all-routes.test.ts
```

Esta prueba compara las rutas capturadas contra los `app/**/page.tsx` concretos.
Si se agrega una pantalla nueva, el test falla hasta que se incorpore al script
con un fixture navegable.
También valida que el script declare fixtures mock para los apartados operativos
y administrativos esperados.

### 4.6. Resolución de problemas de capturas

#### `CAPTURE_DATABASE_URL is required`

Define explícitamente la base de capturas:

```bash
CAPTURE_DATABASE_URL=postgres:///bodega_capture CAPTURE_ALLOW_DESTRUCTIVE_RESET=true npx tsx scripts/capture-all-routes.ts
```

#### `CAPTURE_ALLOW_DESTRUCTIVE_RESET=true is required`

El script bloquea resets accidentales. Confirma que la DB es desechable y agrega
la variable:

```bash
CAPTURE_ALLOW_DESTRUCTIVE_RESET=true
```

#### `Database "bodega" is not disposable`

La base no tiene marcador seguro. Usa un nombre como:

```text
bodega_capture
bodega_e2e
bodega_tmp
```

#### El servidor no inicia

Ejecuta primero:

```bash
npm run build
```

El script usa `next start`, por lo que necesita un build previo. Si el puerto
`3127` está ocupado, define `CAPTURE_PORT`.

---

## 5. Prueba manual siguiendo el flujo completo

Para probar la aplicación manualmente como lo haría un usuario real.

### 5.1. Setup inicial

```bash
npm install
cp .env.example .env        # ajusta si existe; si no, crea .env con:
                            # AUTH_SECRET=<un-secreto-aleatorio>
                            # NEXTAUTH_SECRET=<el-mismo-secreto>
npm run db:migrate          # aplica migraciones
npm run db:seed             # crea faenas/trabajadores y catálogo EPP base
npm run dev                 # http://localhost:3000
```

### 5.2. Flujo paso a paso

#### Paso 1 — Registrar administrador

- Abre `http://localhost:3000/registro`
- Como es el primer usuario, el sistema te asigna rol **Administrador**
- Usa cualquier correo electrónico
- Anota el correo y contraseña

#### Paso 2 — Configurar catálogo

| Tarea | Ruta | Descripción |
|-------|------|-------------|
| Crear faenas | `/admin/faenas` | Una o más faenas con centros de costo |
| Crear proveedores | `/admin/proveedores` | Al menos un proveedor |
| Crear categorías | `/admin/productos` | Categorías de productos |
| Crear productos | `/admin/productos` | Productos con SKU, nombre, precio referencia |

#### Paso 3 — Crear usuarios por rol

- Ve a `/admin/usuarios` → **Crear usuario**
- Crea al menos estos roles:

| Rol | Faenas | Descripción |
|-----|--------|-------------|
| Administrador | Cualquiera | Control total |
| Jefatura | Cualquiera | Aprueba y gestiona órdenes de compra |
| Prevencionista faena | Faena específica | Crea solicitudes |
| Secretaría | Cualquiera | Apoyo administrativo |
| Prevencionista oficina | Cualquiera | Aprueba EPP |

#### Paso 4 — Flujo de solicitud

1. Inicia sesión como **Prevencionista faena**
2. Ve a `/solicitudes/nueva`
3. Selecciona faena y centro de costo
4. Busca un producto del catálogo o escribe uno libre
5. Ingresa cantidad y envía a aprobación

#### Paso 5 — Aprobación

1. Inicia sesión como **Jefatura** o **Administrador**
2. Ve a `/aprobaciones`
3. Revisa los ítems pendientes
4. Haz clic en **Aprobar** (o **Rechazar** con motivo)
5. Confirma la acción

#### Paso 6 — Orden de compra (OC)

1. Ve a `/compras/nueva`
2. Selecciona la faena y el proveedor
3. Marca los ítems aprobados para incluir en la OC
4. Ajusta precio unitario si corresponde
5. Haz clic en **Crear OC**
6. En el detalle de la OC: haz clic en **Emitir orden**
7. Recarga la página y haz clic en **Marcar como enviada**

#### Paso 7 — Recepción

1. Ve a `/recepcion/nueva?oc=ID_DE_LA_OC`
2. Confirma o ajusta la cantidad recibida
3. Haz clic en **Marcar como recibido**

#### Paso 8 — Factura

1. Ve al detalle de la OC
2. En **Facturas anexas**, ingresa número, fecha, monto y archivo
3. Haz clic en **Anexar factura**

#### Paso 9 — Trazabilidad

- Ve a `/trazabilidad` para ver el estado de cada ítem
- Filtra por estado (aprobado, en OC, comprado, recibido, etc.)

#### Paso 10 — Reportes

- Ve a `/reportes` para ver métricas
- Exporta a Excel con los botones correspondientes

### 5.3. Datos de prueba rápidos (seed)

Si necesitas datos de prueba pre-poblados, puedes editar `db/seed.ts` y volver a
ejecutar `npm run db:seed`. El seed actual solo crea faenas/trabajadores y el
catálogo EPP; usuarios y datos operativos deben crearse desde la UI.

---

## 6. Cobertura

```bash
npm run test:coverage
```

Genera un reporte en `coverage/lcov-report/index.html`. La cobertura se mide
sobre `lib/**/*.ts` (lógica de negocio). No incluye componentes UI, server actions
ni páginas.

### Estado actual

- **213 tests** pasando y **1 skipped**
- **37 suites** ejecutadas y **1 skipped**
- Cobertura de declaraciones: ~4.35% (enfocado en lógica pura: transiciones de estado, permisos, totales)
- La cobertura baja es esperada porque los server actions, páginas y componentes no están instrumentados

---

## 7. Resolución de problemas

### Los tests unitarios fallan

```bash
# Limpiar caché de vitest
npx vitest --clearCache
npm test
```

### Los tests E2E fallan

```bash
# Verificar que el puerto 3100 está libre
lsof -i :3100

# Forzar recreación de la base de datos E2E desechable
DATABASE_URL=postgres:///bodega_e2e E2E_ALLOW_DESTRUCTIVE_RESET=true npm run e2e:setup

# Ejecutar con más traza
DEBUG=pw:api npx playwright test
```

### Error de módulo no encontrado en tests

Si agregas un import a un módulo que no está mockeado en un test unitario,
vitest puede fallar al cargar dependencias de Next.js. Solución:

```ts
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))
```

### TypeScript en tests

Los archivos de test se compilan con `tsconfig.json` del proyecto. Si usas
aliases `@/` funciona gracias a `tsconfigPaths: true` en `vitest.config.ts`.

---

## Referencias

- [Vitest](https://vitest.dev/)
- [Playwright](https://playwright.dev/)
- [Drizzle ORM — Testing](https://orm.drizzle.team/docs/test)
