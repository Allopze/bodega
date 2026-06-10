# Testing — Chome Solicitudes y Bodega

Este documento describe los tipos de prueba disponibles, cómo ejecutarlos y el
flujo completo para validar la aplicación.

---

## Índice

1. [Tipos de prueba](#1-tipos-de-prueba)
2. [Pruebas unitarias (vitest)](#2-pruebas-unitarias-vitest)
3. [Pruebas E2E (Playwright)](#3-pruebas-e2e-playwright)
4. [Prueba manual siguiendo el flujo completo](#4-prueba-manual-siguiendo-el-flujo-completo)
5. [Cobertura](#5-cobertura)
6. [Resolución de problemas](#6-resolución-de-problemas)

---

## 1. Tipos de prueba

| Tipo | Herramienta | Alcance | Database |
|------|-------------|---------|----------|
| Unitarias | vitest | Lógica pura (transiciones de estado, permisos, totales, validaciones) | Ninguna (datos mock en memoria) |
| E2E | Playwright | Flujo completo desde el navegador (login → solicitud → aprobación → OC → factura → recepción) | SQLite dedicada en `.tmp/e2e.sqlite` |
| Manual | Navegador + dev server | Exploración visual, casos borde no automatizados | SQLite local en `db/stockflow.db` |

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
└── report-export.test.ts         # Generación de reportes XLSX
```

### 2.3. Qué prueban

| Archivo | Sujeto | Dependencias externas |
|---------|--------|-----------------------|
| `auth-can.test.ts` | `lib/auth/can.ts` | next-auth (mockeado) |
| `auth-rbac.test.ts` | Reglas de negocio RBAC | Ninguna |
| `item-state.test.ts` | `canTransition()`, `ALLOWED_TRANSITIONS` | Ninguna |
| `order-totals.test.ts` | `computeOrderTotals()` | Ninguna |
| `postpone-item-action.test.ts` | `postponeItemAction()` (server action) | next-auth + DB (mockeados) |
| `report-export.test.ts` | Exportación XLSX | DB mockeada |

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

El archivo `e2e/purchase-flow.spec.ts` contiene **2 tests**:

| Test | Descripción |
|------|-------------|
| `flujo solicitud, aprobación, OC, factura, recepción y trazabilidad` | Recorre el ciclo completo: login → crear solicitud → aprobar → crear OC → emitir → marcar enviada → adjuntar factura → marcar recibido → validar trazabilidad → validar export Excel |
| `descarga real de Excel desde el navegador` | Va a Reportes, hace clic en un link Excel, intercepta la descarga y verifica que el archivo no esté vacío |

### 3.4. Base de datos E2E

Playwright usa una base de datos SQLite **independiente y efímera**:

```
.tmp/e2e.sqlite
```

Se crea desde cero con `e2e/setup-db.ts` cada vez que se ejecutan los tests.
Contiene datos semilla fijos:

| Dato | Valor |
|------|-------|
| Admin | `admin@e2e.chome.cl` / `chome2026` |
| Faena | Faena E2E |
| Centro de costo | Centro E2E |
| Proveedor | Proveedor E2E |
| Producto | Guante E2E (SKU: E2E-001) |

### 3.5. Arquitectura

```
playwright.config.ts
  └── webServer → e2e/start-server.sh
                    ├── npm run e2e:setup   (corre setup-db.ts)
                    ├── npm run build       (next build)
                    └── next start --port 3100
```

Cada ejecución E2E:
1. Elimina la base de datos anterior (`.tmp/e2e.sqlite`, `.tmp/e2e.sqlite-wal`, `.tmp/e2e.sqlite-shm`)
2. Crea una nueva con las migraciones y datos semilla
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
```

Playwright captura trace y video automáticamente en caso de falla.

---

## 4. Prueba manual siguiendo el flujo completo

Para probar la aplicación manualmente como lo haría un usuario real.

### 4.1. Setup inicial

```bash
npm install
cp .env.example .env        # ajusta si existe; si no, crea .env con:
                            # AUTH_SECRET=<un-secreto-aleatorio>
                            # NEXTAUTH_SECRET=<el-mismo-secreto>
npm run db:migrate          # aplica migraciones
npm run db:seed             # crea roles, permisos y datos base
npm run dev                 # http://localhost:3000
```

### 4.2. Flujo paso a paso

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
| Jefa Chome | Cualquiera | Aprueba y gestiona órdenes de compra |
| Prevencionista de faena | Faena específica | Crea solicitudes |
| Secretaria | Cualquiera | Apoyo administrativo |
| Prevencionista | Cualquiera | Aprueba EPP |

#### Paso 4 — Flujo de solicitud

1. Inicia sesión como **Prevencionista de faena**
2. Ve a `/solicitudes/nueva`
3. Selecciona faena y centro de costo
4. Busca un producto del catálogo o escribe uno libre
5. Ingresa cantidad y envía a aprobación

#### Paso 5 — Aprobación

1. Inicia sesión como **Jefa Chome** o **Administrador**
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

### 4.3. Datos de prueba rápidos (seed)

Si necesitas datos de prueba pre-poblados, puedes editar `db/seed.ts` y volver a
ejecutar `npm run db:seed`. El seed actual solo crea roles y permisos del sistema;
los datos operativos deben crearse desde la UI.

---

## 5. Cobertura

```bash
npm run test:coverage
```

Genera un reporte en `coverage/lcov-report/index.html`. La cobertura se mide
sobre `lib/**/*.ts` (lógica de negocio). No incluye componentes UI, server actions
ni páginas.

### Estado actual

- **85 tests** pasando
- **6 suites** (archivos de test)
- Cobertura de declaraciones: ~4.35% (enfocado en lógica pura: transiciones de estado, permisos, totales)
- La cobertura baja es esperada porque los server actions, páginas y componentes no están instrumentados

---

## 6. Resolución de problemas

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

# Forzar recreación de la base de datos E2E
rm -rf .tmp/e2e.sqlite*
npm run e2e:setup

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
