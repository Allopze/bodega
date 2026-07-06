# Arquitectura — Plataforma Chome

Documento técnico completo de la arquitectura del sistema.

---

## Stack tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.10 |
| Lenguaje | TypeScript (strict) | 5.x |
| Base de datos | PostgreSQL | vía `postgres` + `drizzle-orm/postgres-js` |
| ORM | Drizzle ORM | latest |
| Autenticación | NextAuth v5 beta (Credentials, JWT) | 5.x |
| Estilos | Tailwind CSS v4 + `tw-animate-css` | 4.x |
| Componentes UI | Radix UI primitives | latest |
| Íconos | Phosphor Icons | latest |
| Fuentes | Geist Sans, Geist Mono, Source Serif 4 | Google Fonts |
| Data fetching | TanStack React Query v5 | 5.x |
| Validación | Zod v4 | 4.x |
| Exportación | ExcelJS (XLSX) | latest |
| Hashing | bcryptjs | latest |
| Notificaciones | Sonner (toasts) | latest |
| Utilidades | clsx, tailwind-merge, class-variance-authority | latest |
| Testing | Vitest + Playwright + Testing Library | latest |
| Linting | ESLint 9 (`eslint-config-next`) | 9.x |

---

## Registry modular

El sistema conserva un **registry modular** para navegación, permisos declarados
y grants por defecto. La implementación viva del negocio está en `lib/` y
`app/(app)/**/actions.ts`; la migración de implementaciones a módulos está
pausada. Ver [ADR 0001](../adr/0001-monolito-modular.md) para la decisión
histórica y `modules/README.md` para el estado actual.

### Diagrama de dependencias

```
lib/ + app/(app)/**/actions.ts  ←── app/(app)/<ruta>/
modules/<nombre>/manifest.ts    ←── modules/registry.ts ←── components/layout/nav-items.ts
```

Las flechas apuntan en la dirección "puede importar de".
Los manifests no contienen lógica de negocio; solo declaran permisos, nav y grants.

### Añadir un módulo nuevo

1. Crear `modules/<nombre>/manifest.ts` con `{ id, permissions, nav, defaultGrants? }`
2. Agregar **una línea** en `modules/registry.ts`: `import { miModulo } from "@/modules/<nombre>/manifest"`
3. Añadirlo al array `registry`
4. Implementar la lógica viva en `lib/` + `app/`, salvo que se retome formalmente la migración modular con tests de paridad.

Los permisos, la navegación del sidebar y el seed RBAC se derivan automáticamente.

### Módulos registrados

| ID | Permisos | Descripción |
|---|---|---|
| `admin` | 10 | Usuarios, faenas, productos, proveedores, trabajadores, configuración, auditoría |
| `requests` | 5 | Solicitudes de compra |
| `approvals` | 1 | Aprobaciones de ítems |
| `purchasing` | 5 | Órdenes de compra |
| `receiving` | 3 | Recepción de mercadería |
| `warehouse` | 3 | Stock y movimientos |
| `deliveries` | 2 | Entregas |
| `traceability` | 1 | Vista de trazabilidad |
| `reports` | 1 | Reportes y exportaciones |
| `analytics` | 2 | Analítica |
| `repuestos` | 5 | Solicitudes de repuestos |
| `servicios` | 5 | Solicitudes de servicios |
| `sst` | 5 | Evaluaciones SST |
| `ppa` | 3 | Prevención de Peligros en el Área |
| `feedback` | 4 | Soporte / feedback interno |
| `combustibles` | 7 | Cargas, cuentas corrientes, import de combustible |
| `flota` | 1 | Vehículos |
| `mantenciones` | 3 | Mantención de flota/equipos |
| `prevention` | 13 | Documentación SST, capacitaciones, incidentes, inspecciones, alcotest, etc. |

**Total: 79 permisos** — derivados automáticamente del registry (`modules/registry.ts`).
Este módulo creció de 9 a 19 entradas a medida que se sumaron repuestos, servicios,
SST, PPA, feedback, combustibles, flota, mantenciones y prevención; recalcular con
`npx tsx -e "import { registry } from './modules/registry'; console.log(registry.map((m) => [m.id, m.permissions.length]))"`
si vuelve a quedar desactualizado.

---

## Estructura del proyecto

```
plataforma-chome/
├── app/                              # Next.js App Router
│   ├── layout.tsx                    # Root layout (fuentes, metadata, HTML lang="es-CL")
│   ├── globals.css                   # Estilos globales + design tokens (OKLCH)
│   ├── page.tsx                      # Redirect raíz → /dashboard
│   ├── (auth)/                       # Grupo de rutas públicas (sin AppShell)
│   │   ├── login/page.tsx
│   │   └── registro/page.tsx
│   ├── (app)/                        # Grupo de rutas autenticadas (con AppShell)
│   │   ├── layout.tsx                # AppShell, sesión, badge counts
│   │   ├── dashboard/page.tsx        # Work queue + KPIs
│   │   ├── solicitudes/              # Solicitudes de compra
│   │   │   ├── [id]/page.tsx         # Detalle + duplicar
│   │   │   └── nueva/page.tsx        # Nueva solicitud
│   │   ├── aprobaciones/             # Aprobaciones por ítem
│   │   ├── compras/                  # Órdenes de compra
│   │   │   ├── [id]/page.tsx         # Detalle OC + acciones
│   │   │   └── nueva/page.tsx        # Nueva OC
│   │   ├── recepcion/                # Recepción de mercadería
│   │   ├── bodega/                   # Bodega (stock, kardex, devoluciones)
│   │   ├── entregas/                 # Entregas a faena/trabajador
│   │   ├── trazabilidad/             # Matriz de trazabilidad
│   │   ├── reportes/                 # Reportes + exportación XLSX
│   │   └── admin/                    # Administración
│   │       ├── usuarios/             # CRUD usuarios + invitaciones
│   │       ├── faenas/               # CRUD faenas
│   │       ├── trabajadores/         # CRUD trabajadores
│   │       ├── productos/            # Catálogo (productos, categorías, atributos)
│   │       ├── proveedores/          # CRUD proveedores
│   │       ├── configuracion/        # Configuración del sistema
│   │       └── auditoria/            # Visor de logs de auditoría
│   ├── (print)/                      # Grupo de rutas para impresión
│   │   └── compras/[id]/print/       # Vista A4 imprimible de OC
│   └── api/                          # API routes
│       ├── auth/[...nextauth]/       # NextAuth handler
│       ├── attachments/[id]/         # Archivos adjuntos
│       ├── notifications/            # Polling de notificaciones
│       ├── reportes/export/          # Exportación XLSX de reportes
│       └── trazabilidad/export/      # Exportación XLSX trazabilidad
├── components/
│   ├── ui/                           # 20+ componentes de sistema de diseño
│   │   ├── button.tsx, input.tsx, textarea.tsx, select.tsx
│   │   ├── field.tsx, label.tsx
│   │   ├── dialog.tsx, sheet.tsx, dropdown-menu.tsx, popover.tsx
│   │   ├── tabs.tsx, checkbox.tsx, tooltip.tsx, collapsible.tsx
│   │   ├── data-table.tsx, empty-state.tsx, skeleton.tsx
│   │   ├── badge.tsx, page-header.tsx, avatar.tsx
│   │   └── scroll-area.tsx, separator.tsx, visually-hidden.tsx, slot.tsx
│   ├── layout/                       # AppShell, Sidebar, TopBar, NavItems
│   ├── providers/                    # SessionProvider, QueryProvider
│   ├── states/                       # StateBadge, EntityTimeline, RequestProgress
│   ├── admin/                        # DataTable, Sheet, FormState, SubmitButton
│   └── __tests__/                    # Tests de componentes
├── db/
│   ├── schema/                       # 22 archivos de esquema Drizzle + index.ts (creció con
│   │   │                             # combustibles, PPA, SST, mantención, feedback, etc.)
│   │   ├── users.ts                  # users, roles, permissions, invitations, user_roles, worksite_users
│   │   ├── worksites.ts              # worksites, suppliers, workers
│   │   ├── products.ts               # products, categories, attributes, product_suppliers
│   │   ├── requests.ts               # purchase_requests, purchase_request_items, request_item_attributes
│   │   ├── purchasing.ts             # purchase_orders, purchase_order_items, quotations
│   │   ├── receiving.ts              # receipts, receipt_items
│   │   ├── repuestos.ts / servicios.ts # solicitudes unificadas de repuestos y servicios
│   │   ├── stock.ts                  # worksite_stock, inventory_movements
│   │   ├── audit.ts                  # audit_log, status_history, attachments
│   │   ├── sst.ts / ppa.ts           # Evaluaciones SST y Prevención de Peligros en el Área
│   │   ├── maintenance.ts            # Mantención de flota/equipos
│   │   ├── fuel-*.ts                 # fuel-invoices, fuel-suppliers, fuel-vehicles (combustibles)
│   │   ├── feedback.ts               # Soporte / feedback interno
│   │   ├── cost-centers.ts, email-templates.ts, code-sequences.ts, rate-limits.ts
│   │   └── system-settings.ts        # system_settings, notifications
│   ├── migrations/                   # 19 migraciones SQL versionadas (0000..0018; ver
│   │                                 # db/migrations/README.md sobre el baseline 2026-06-25)
│   ├── index.ts                      # Singleton Drizzle + postgres-js
│   └── seed.ts                       # Seed inicial (roles, permisos, catálogo EPP)
├── lib/
│   ├── auth/                         # NextAuth config, RBAC, permisos, visibilidad
│   │   ├── auth.ts                   # Configuración NextAuth (credentials, JWT)
│   │   ├── can.ts                    # Guards: can(), canAny(), requirePermission()
│   │   ├── rbac.ts                   # RBAC snapshot con caché 60s
│   │   ├── visibility.ts             # Filtrado por faena (scoping)
│   │   └── types.ts                  # Tipos de permisos (79 permisos)
│   ├── services/                     # Lógica de negocio
│   │   ├── system-settings.ts        # Perfil empresa, límite PDF
│   │   ├── notifications.ts          # Creación de notificaciones in-app
│   │   ├── rate-limit.ts             # Rate limiting persistente
│   │   ├── stock.ts                  # Movimientos de stock
│   │   ├── stock-alerts.ts           # Alertas de stock mínimo
│   │   └── trazabilidad-export.ts    # Exportación XLSX trazabilidad
│   ├── reports/                      # Exportación XLSX (ExcelJS)
│   │   └── export.ts                 # Builder genérico de buffers XLSX
│   ├── validation/                   # Schemas Zod
│   │   ├── masters.ts                # Validación de datos maestros
│   │   └── operations.ts             # Validación de entidades operativas
│   ├── hooks/                        # React hooks
│   │   ├── use-login.ts
│   │   └── use-notifications.ts
│   ├── audit.ts                      # recordAudit() + recordStatusChange()
│   ├── code-sequences.ts             # Generador transaccional de códigos
│   ├── id.ts                         # nanoid() + generateCode()
│   ├── work-queue.ts                 # Constructor de work queue del dashboard
│   ├── utils.ts                      # Utilidades generales
│   └── logger.ts                     # Logger
├── docs/                             # Documentación del proyecto
├── e2e/                              # Tests Playwright E2E
│   ├── purchase-flow.spec.ts         # Flujo completo
│   └── setup-db.ts                   # Setup de BD efímera para E2E
├── scripts/                          # Scripts auxiliares
├── public/                           # Assets estáticos (logos SVG)
└── Config files:
    ├── next.config.ts                # Next.js (security headers, image domains)
    ├── drizzle.config.ts             # Drizzle Kit (schema, out, dialect)
    ├── vitest.config.ts              # Vitest (aliases, coverage)
    ├── playwright.config.ts          # Playwright (webServer, puerto 3100)
    ├── eslint.config.mjs             # ESLint 9
    ├── postcss.config.mjs            # PostCSS (Tailwind)
    └── tsconfig.json                 # TypeScript (strict, aliases @/)
```

---

## Base de datos

### Motor

PostgreSQL vía `postgres` con Drizzle ORM. La conexión se define con `DATABASE_URL` y el singleton Drizzle previene múltiples clientes en HMR de desarrollo.

### Esquema completo

#### Autenticación y RBAC (`users.ts`)

| Tabla | Propósito | Columnas clave |
|---|---|---|
| `users` | Cuentas de usuario | id, name, email, hashedPassword, avatarColor, isActive, avatarColor |
| `user_invitations` | Invitaciones por email | id, email, tokenHash, role, worksiteId, expiresAt, acceptedAt |
| `roles` | Roles del sistema | id, name (administrador, jefa_chome, secretaria, prevencionista, solicitante_faena) |
| `permissions` | Permisos granulares | id, key (79 permisos), description |
| `role_permissions` | M:N rol ↔ permiso | roleId, permissionId |
| `user_roles` | M:N usuario ↔ rol | userId, roleId, isPrimary |
| `worksite_users` | Scoping usuario ↔ faena | userId, worksiteId, isPrimary |

#### Datos maestros (`worksites.ts`)

| Tabla | Propósito |
|---|---|
| `worksites` | Faenas (name, code, address, region, isActive) |
| `suppliers` | Proveedores (name, rut, contact, email, phone, address, paymentTerms) |
| `workers` | Trabajadores (rut, firstName, lastName, position, worksiteId) |

#### Catálogo (`products.ts`)

| Tabla | Propósito |
|---|---|
| `product_categories` | Categorías (name, isEpp, requiresPrevencion) |
| `products` | Productos (sku, name, description, categoryId, unitOfMeasure, referencePrice) |
| `product_attributes` | Atributos (name, type: text/select/number, options JSON, required) |
| `product_suppliers` | Proveedores preferidos + precios por producto |

#### Solicitudes (`requests.ts`)

| Tabla | Propósito |
|---|---|
| `purchase_requests` | Encabezado (code, worksiteId, requesterId, type, urgency, status) |
| `purchase_request_items` | Ítems individuales (productId, quantity, status, workerId, supplierHint) |
| `request_item_attributes` | Valores de atributos (talla, color, medida) por ítem |

#### Aprobaciones (`approvals.ts`)

| Tabla | Propósito |
|---|---|
| `approval_decisions` | Decisiones por ítem (itemId, approverId, decision, reason, roleContext) |

#### Compras (`purchasing.ts`)

| Tabla | Propósito |
|---|---|
| `purchase_orders` | Encabezado OC (code, supplierId, totals, status, deliveryInfo) |
| `purchase_order_items` | Líneas OC (requestItemId, productId, quantity, unitPrice, discount, receivedQty) |
| `quotations` | Cotizaciones adjuntas a OC |

#### Recepción (`receiving.ts`)

| Tabla | Propósito |
|---|---|
| `receipts` | Encabezado (code, poId, receiverId, worksiteId, guideNumber) |
| `receipt_items` | Líneas (poItemId, quantityReceived, quantityRejected, quantityDamaged) |

#### Entregas (`deliveries.ts`)

| Tabla | Propósito |
|---|---|
| `deliveries` | Encabezado (code, destination, receiver, signature) |
| `delivery_items` | Líneas (requestItemId, productId, quantity) |

#### Bodega (`stock.ts`)

| Tabla | Propósito |
|---|---|
| `worksite_stock` | Stock por producto por faena (unique: worksiteId + productId) |
| `inventory_movements` | Kardex (type, qty, beforeQty, afterQty, reference, reason) |

Movimientos: `receipt`, `delivery`, `adjustment`, `transfer`, `return`, `rejection`, `loss`.

#### Sistema (`audit.ts`, `system.ts`)

| Tabla | Propósito |
|---|---|
| `audit_log` | Registro de acciones (userId, action, entityType, entityId, oldState, newState, reason) |
| `status_history` | Transiciones de estado (entityType, entityId, fromStatus, toStatus) |
| `attachments` | Archivos (entityType, entityId, fileName, fileType, fileSize, storageKey) |
| `notifications` | In-app (userId, type, title, body, read, href) |
| `system_settings` | Key-value (pdf_max_size_mb, company_profile) |
| `code_sequences` | Auto-incremento (prefix, year, lastNumber) |
| `rate_limits` | Rate limiting persistente (key, points, duration, blockedUntil) |

---

## Ciclo de vida del ítem (máquina de estados)

El ítem es la unidad central de control. Todo el sistema gira alrededor de su trazabilidad.

```
                     ┌──────────┐
                     │  draft   │
                     └────┬─────┘
                          │ submit
                     ┌────▼─────┐
              ┌──────│ requested│──────┐
              │      └────┬─────┘      │
              │           │ approve    │ reject
              │      ┌────▼─────┐  ┌───▼────┐
              │      │ approved │  │rejected│ (terminal)
              │      └────┬─────┘  └────────┘
              │           │ add to OC
              │      ┌────▼──────────┐
              │      │in_purchase_order│
              │      └────┬──────────┘
              │           │ OC issued
              │      ┌────▼─────┐
              │      │ purchased│
              │      └────┬─────┘
              │           │ receive partial
              │      ┌────▼────────────┐
              │      │partially_received│
              │      └────┬────────────┘
              │           │ receive full
              │      ┌────▼─────┐
              │      │ received │
              │      └────┬─────┘
              │           │ deliver partial
              │      ┌────▼─────────────┐
              │      │partially_delivered│
              │      └────┬─────────────┘
              │           │ deliver full
              │      ┌────▼─────┐
              │      │ delivered│ (terminal)
              │      └──────────┘
              │
              ├── postpone ──► postponed
              └── return ────► returned
```

### Estados de solicitud

```
draft → submitted → in_review → partially_approved → approved → in_purchasing → closed
  ↓         ↓           ↓               ↓                                      ↑
cancelled  returned   rejected      (mixed)                                cancelled
```

### Estados de orden de compra

```
draft → issued → sent → supplier_confirmed → partially_received → received → closed
                                                      ↑
                                                  cancelled
```

---

## Autenticación y autorización

### NextAuth

- **Estrategia**: Credentials (email + contraseña) con JWT sessions.
- **Hashing**: bcrypt con cost factor 12.
- **Rate limiting**: Persistente en Postgres, doble llave (IP + email). Bloquea tras N intentos fallidos consecutivos.
- **Registro**: Primer usuario obtiene rol `administrador`. Registros subsecuentes requieren invitación.

### RBAC

**12 roles predefinidos** (crecieron desde los 5 originales a medida que se
agregaron los módulos de prevención/mantención/combustibles; fuente de verdad:
`SYSTEM_ROLES` en `lib/auth/system-rbac.ts`):

| Rol | Visibilidad | Alcance |
|---|---|---|
| `administrador` | Todas las faenas | Control total del sistema |
| `jefa_chome` | Todas las faenas | Aprobar, comprar, recibir, despachar |
| `secretaria` | Todas las faenas | Aprobar, comprar, recibir, despachar |
| `prevencionista` | Todas las faenas | Jefa Dpto. Prevención de riesgos |
| `solicitante_faena` | Solo faenas asignadas | Crear y enviar solicitudes |
| `prevencionista_faena` | Solo faenas asignadas | Solicita EPP y servicios desde faena |
| `jefe_mantencion` | Todas las faenas | Gestión de mantención de flota/equipos |
| `conductor_lider` | Solo faenas asignadas | Evaluaciones SST de conductores |
| `admin_contrato` | Solo faenas asignadas | Administrador de contrato / Supervisor de faena |
| `supervisor_faena` | Solo faenas asignadas | Supervisor de faena |
| `jefe_terreno` | Solo faenas asignadas | Jefe de terreno |
| `cphs` | Solo faenas asignadas | Comité Paritario de Higiene y Seguridad |

**79 permisos granulares** derivados del registry de módulos (`modules/registry.ts`
vía `modules/permissions.ts`), organizados por módulo. Ejemplos representativos
(la lista completa vive en el registry, no se mantiene a mano acá):

- `requests:create`, `requests:view_own`, `requests:view_all`, `requests:submit`
- `approvals:approve`
- `purchasing:view`, `purchasing:create_order`, `purchasing:send_order`
- `receiving:view`, `receiving:register`
- `warehouse:view_stock`, `warehouse:register_movement`
- `deliveries:view`, `deliveries:register`
- `reports:view`
- `repuestos:create`, `repuestos:submit`; `servicios:create`, `servicios:submit`
- `combustibles:import`
- `sst:view`, `sst:create`, `sst:close`, `sst:manage`
- `prevention:docs:manage`, `prevention:docs:manage_sensitive`, `prevention:docs:manage_restricted`
- `admin:users`, `admin:worksites`, `admin:products`, `admin:suppliers`, `admin:workers`, `admin:settings`, `admin:audit`
- `trazabilidad:view`

### Guards

```typescript
// Verificación simple
can(user, "requests:create")

// Verificación múltiple (OR)
canAny(user, ["requests:view_own", "requests:view_all"])

// Server action guard (lanza error si no tiene permiso)
await requirePermission("purchasing:create_order")

// Middleware de página
await guardPermission("admin:users")
```

### Scoping por faena

- Usuarios con rol `solicitante_faena` solo ven datos de sus faenas asignadas en `worksite_users`.
- Roles globales ven todas las faenas.
- El filtrado ocurre a nivel SQL, no en memoria.
- Caché RBAC de 60 segundos, invalidado en cambios de perfil.

---

## Patrones y convenciones

### Server Actions

Las mutaciones se implementan como Server Actions de Next.js dentro de `app/`. Cada acción:
1. Valida la sesión (`requirePermission` o `can`).
2. Valida los datos de entrada con Zod.
3. Ejecuta la operación en la BD dentro de una transacción.
4. Registra auditoría (`recordAudit`).
5. Revalida las rutas afectadas (`revalidatePath`).
6. Retorna `{ success: true }` o `{ error: string }`.

### Componentes

- **UI primitives**: En `components/ui/`, todos basados en Radix UI + Tailwind con tokens de diseño.
- **Patrón Field**: `label` + `helper` + `error` con `aria-labelledby` y `aria-describedby`.
- **DataTable**: Client-side para listas administrativas. Cast requerido: `as unknown as Record<string, unknown>[]`.
- **SubmitButton**: Botón con estado loading (`Guardando...`) integrado.

### Códigos y secuencias

Códigos auto-generados con formato `{PREFIJO}-{AÑO}-{SECUENCIA}`:

- `SOL-2026-0042` — Solicitudes
- `OC-2026-0017` — Órdenes de compra
- `REC-2026-0005` — Recepciones
- `ENT-2026-0003` — Entregas

Implementados en `lib/code-sequences.ts` con transacción atómica.

### Auditoría

Cada mutación de estado se registra en dos tablas:
- `audit_log`: quién, qué, cuándo, estado anterior/nuevo (JSON), motivo.
- `status_history`: transición fromStatus → toStatus.

### Adjuntos y storage

Los comprobantes de entrega se guardan en el filesystem local bajo
`storage/deliveries/` y se referencian desde la tabla `attachments`.
La API de descarga valida autenticación, permiso por faena y que la ruta quede
dentro de ese prefijo antes de leer el archivo.
Por defecto esa carpeta vive en `./storage`; para despliegues serverful se puede
configurar `STORAGE_PATH` con la ruta absoluta de un volumen persistente. Las
rutas persistidas en `attachments.file_path` se mantienen relativas
(`storage/deliveries/...`) para no acoplar la base al path físico del servidor.

Requisitos operativos si se despliega con storage local:

- Montar `STORAGE_PATH` o `storage/` en un volumen persistente, no en el filesystem efímero del contenedor.
- Incluir `storage/` en la política de backup junto con la base Postgres.
- Restaurar base de datos y archivos como una unidad consistente, porque `attachments.file_path` referencia archivos físicos.
- Evitar múltiples instancias escribiendo a discos locales distintos; para escalar horizontalmente, mover adjuntos a object storage.
- Definir retención de comprobantes según política interna antes de purgas manuales o automáticas.

---

## Decisiones arquitectónicas

1. **PostgreSQL como BD única** — Base relacional centralizada con migraciones Drizzle versionadas, adecuada para concurrencia operativa, pruebas E2E desechables y despliegues con múltiples procesos.

2. **Per-item state tracking** — La arquitectura central es el ítem, no la solicitud ni la OC. Cada ítem tiene su propio estado independiente. Esto resuelve el problema de "ítems perdidos".

3. **Sin API REST explícita** — Las mutaciones usan Server Actions, no endpoints REST. Solo existen API routes para: auth, attachments, notificaciones, y exportación XLSX.

4. **Sin estado global** — No se usa Redux/Zustand. React Query maneja el caché del servidor. La sesión se obtiene vía `SessionProvider`.

5. **Exportación solo XLSX** — Regla de proyecto: nunca CSV. Siempre ExcelJS con formato.

6. **Sin librería de animación externa** — Solo transiciones CSS y RadUI primitives. Se respeta `prefers-reduced-motion`.

7. **Single-tenant** — Una instalación por organización. No hay multi-tenancy.

---

## Seguridad

### Headers HTTP

Configurados en `next.config.ts`:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=63072000`

### Rate limiting

Persistente en Postgres (`rate_limits`). Doble llave IP + email. Bloquea tras intentos fallidos consecutivos en login.

### Validación

- Zod en todas las entradas de usuario (server actions).
- Schemas separados: `masters.ts` (datos maestros) y `operations.ts` (entidades operativas).

### Worksite scoping

El filtrado por faena ocurre en SQL (`WHERE worksiteId IN (...)`), no en código aplicación. Previene fugas de datos entre faenas.

---

## Testing

| Capa | Herramienta | Ubicación |
|---|---|---|
| Unitario | Vitest | `lib/__tests__/`, `components/__tests__/` |
| E2E | Playwright | `e2e/` |
| Cobertura | v8 (vitest) | Target: `lib/**/*.ts` |

Suite Vitest y Playwright. E2E con BD Postgres desechable `postgres:///bodega_e2e`, datos semilla fijos, puerto 3100.

---

## Dependencias de build

```bash
npm install          # Instala dependencias
npm run db:migrate   # Aplica migraciones versionadas
npm run db:seed      # Crea roles, permisos y catálogo EPP base
npm run dev          # Dev server en :3001
npm run build        # Build de producción
npm test             # Unit tests
npm run test:e2e     # E2E tests
```
