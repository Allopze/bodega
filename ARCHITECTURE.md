# Arquitectura — Plataforma Chome

Documento técnico de la arquitectura del sistema. Fuente de verdad viva:
`lib/` + `app/(app)/**/actions.ts`. El scaffolding modular (`modules/`) solo
sobrevive para navegación, permisos y seed (ver [AGENTS.md](AGENTS.md)).

---

## Stack tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.9 |
| Runtime UI | React | 19.2 |
| Lenguaje | TypeScript (strict) | 5.x |
| Base de datos | PostgreSQL | vía `postgres` + `drizzle-orm/postgres-js` |
| ORM | Drizzle ORM | 0.45 |
| Autenticación | NextAuth v5 (Credentials, JWT) | 5.0.0-beta.31 |
| Estilos | Tailwind CSS v4 + `tw-animate-css` | 4.x |
| Componentes UI | Radix UI primitives | latest |
| Íconos | Phosphor Icons | 2.x |
| Fuentes | Exo (títulos), Myriad Pro (cuerpo), Geist Mono (datos) | `next/font/local` + `geist` |
| Data fetching | TanStack React Query | 5.x |
| Validación | Zod | 4.x |
| Exportación | ExcelJS (Excel — **nunca CSV**) | 4.x |
| Hashing | bcryptjs | 3.x |
| Notificaciones | Sonner (toasts) | 2.x |
| Utilidades | clsx, tailwind-merge, class-variance-authority | latest |
| Observabilidad | Sentry | latest |
| Testing | Vitest 4 + Playwright + Testing Library | latest |
| Linting | ESLint 9 (`eslint-config-next`) | 9.x |

> **Este NO es el Next.js que conoces.** Esta versión trae breaking changes.
> Antes de escribir código, lee la guía relevante en `node_modules/next/dist/docs/`.

---

## Registry modular

El sistema conserva un **registry modular** para navegación, permisos declarados
y grants por defecto. La implementación viva del negocio está en `lib/` y
`app/(app)/**/actions.ts`; la migración de la lógica a módulos está **pausada**
(ver [ADR 0001](docs/adr/0001-monolito-modular.md) y `modules/README.md`).

Las únicas partes vivas del scaffolding son `modules/registry.ts`,
`modules/permissions.ts`, `modules/manifest-types.ts` y los
`modules/*/manifest.ts`. No recrear `modules/*/{services,actions,schema,validation}`
ni `core/*` salvo que se retome formalmente la migración con tests de paridad.

### Diagrama de dependencias

```
lib/ + app/(app)/**/actions.ts   ←── app/(app)/<ruta>/
modules/<nombre>/manifest.ts     ←── modules/registry.ts ←── components/layout/nav-items.ts
components/layout/areas.ts        ←── nav-items.ts (agrupa ítems por área)
```

Las flechas apuntan en la dirección "puede importar de". Los manifests **no**
contienen lógica de negocio; solo declaran permisos, entradas de nav (por
`areaId`) y grants.

### Añadir un módulo nuevo

1. Crear `modules/<nombre>/manifest.ts` con `{ id, permissions, nav?, defaultGrants? }`.
2. Agregar **una línea** en `modules/registry.ts` y sumarlo al array `registry`.
3. Si estrena un área de navegación, agregarla a `components/layout/areas.ts`.
4. Implementar la lógica viva en `lib/` + `app/`.

Permisos, sidebar y seed RBAC se derivan automáticamente del registry.

### Módulos registrados (21)

| ID | Permisos | Descripción |
|---|---|---|
| `admin` | 35 | Usuarios, faenas, productos, proveedores, trabajadores, catálogos, configuración, auditoría |
| `requests` | 4 | Solicitudes de compra |
| `approvals` | 1 | Aprobaciones de ítems |
| `purchasing` | 5 | Órdenes de compra |
| `receiving` | 3 | Recepción de mercadería |
| `warehouse` | 10 | Stock, movimientos y guías de despacho internas (Oficina → Faena) |
| `deliveries` | 3 | Entregas |
| `reports` | 1 | Reportes y exportaciones |
| `analytics` | 2 | Analítica |
| `repuestos` | 5 | Solicitudes de repuestos |
| `servicios` | 5 | Solicitudes de servicios |
| `operations` | 1 | Cola operacional transversal |
| `billing` | 12 | Facturación y cobranza (cuentas por cobrar) — ver [docs/facturacion/](docs/facturacion/README.md) |
| `sst` | 5 | Evaluaciones SST |
| `ppa` | 8 | Prevención de Peligros en el Área |
| `feedback` | 4 | Soporte / feedback interno |
| `combustibles` | 22 | Cargas, cuentas corrientes, TAE, anomalías, import de combustible |
| `flota` | 5 | Vehículos |
| `mantenciones` | 4 | Mantención de flota/equipos |
| `prevention` | 124 | Documentación SST, capacitaciones, incidentes, inspecciones, PDTP, indicadores |
| `ti` | 10 | Módulo de TI |

**Total: 271 permisos**, derivados automáticamente. Recalcular con:

```bash
npx tsx -e "import { registry } from './modules/registry'; \
  console.log(registry.length, registry.reduce((a,m)=>a+m.permissions.length,0))"
```

---

## Estructura del proyecto

```
plataforma-chome/
├── app/                              # Next.js App Router
│   ├── layout.tsx                    # Root layout (fuentes Exo/Myriad/Geist, metadata, HTML lang="es-CL")
│   ├── globals.css                   # Design tokens (OKLCH) + utilities tipográficas
│   ├── (auth)/                       # Rutas públicas (login, registro) — sin AppShell
│   ├── (app)/                        # Rutas autenticadas — con AppShell
│   │   ├── layout.tsx                # AppShell, sesión, badge counts, módulos habilitados
│   │   ├── dashboard/                # Work queue + KPIs
│   │   ├── solicitudes/              # Solicitudes de compra
│   │   ├── aprobaciones/             # Aprobaciones por ítem
│   │   ├── compras/                  # Órdenes de compra
│   │   ├── recepcion/                # Recepción de mercadería
│   │   ├── bodega/                   # Stock, kardex, devoluciones
│   │   │   └── guias/                # Guías de despacho internas (Oficina → Faena)
│   │   ├── entregas/                 # Entregas a faena/trabajador
│   │   ├── trazabilidad/             # Matriz de trazabilidad
│   │   ├── reportes/                 # Reportes + exportación Excel
│   │   ├── analitica/                # Analítica
│   │   ├── combustibles/             # Cargas, cuentas corrientes, TAE, bitácora, import
│   │   ├── flota/                    # Vehículos
│   │   ├── mantenciones/             # Mantención de flota/equipos
│   │   ├── prevencion/               # SST: evaluaciones, documentación, PDTP, PPA, indicadores
│   │   ├── soporte/                  # Feedback / soporte interno
│   │   ├── perfil/                   # Perfil de usuario
│   │   ├── admin/                    # Usuarios, faenas, trabajadores, productos, proveedores, config, auditoría
│   │   └── forbidden/                # Página 403
│   ├── (print)/                      # Rutas de impresión A4 (OC, acta SST, comprobante de entrega,
│   │                                 #   guía de despacho interna), con auth check, sin AppShell
│   └── api/                          # API routes (ver abajo)
├── components/
│   ├── ui/                           # ~32 componentes del design system (Radix + Tailwind)
│   ├── layout/                       # AppShell, DesktopNav, MobileNav, TopBar, CommandPalette, areas/nav-items
│   ├── providers/                    # SessionProvider, QueryProvider
│   ├── states/                       # StateBadge, EntityTimeline, RequestProgress
│   └── admin/                        # DataTable, Sheet, FormState, SubmitButton
├── db/
│   ├── schema/                       # 32 archivos de esquema Drizzle + index.ts
│   ├── migrations/                   # 63 migraciones SQL versionadas (0000..0062)
│   ├── index.ts                      # Singleton Drizzle + postgres-js
│   └── seed.ts                       # Seed RBAC + trabajadores + catálogo EPP
├── lib/
│   ├── auth/                         # NextAuth, RBAC (can/canAny/requirePermission), visibilidad por faena
│   ├── services/                     # Lógica de negocio (stock, notificaciones, rate-limit, exports)
│   ├── combustibles/                 # Servicios de combustibles (TAE, Copec, reportes, anomalías)
│   ├── reports/                      # Builder Excel (ExcelJS)
│   ├── validation/                   # Schemas Zod (masters, operations)
│   ├── hooks/                        # React hooks (login, notifications, hide-on-scroll)
│   ├── audit.ts                      # recordAudit() + recordStatusChange()
│   ├── code-sequences.ts             # Generador transaccional de códigos
│   ├── work-queue.ts                 # Constructor de work queue del dashboard
│   └── utils.ts, logger.ts, id.ts, toast.ts
├── docs/                             # Documentación del proyecto (ADRs, deploy, auditorías, dominio)
├── e2e/                              # Tests Playwright E2E
├── scripts/                          # Scripts auxiliares (run-e2e.sh, etc.)
├── storage/                          # Adjuntos en filesystem (configurable con STORAGE_PATH)
├── public/                           # Assets estáticos (logos SVG)
└── Config: next.config.ts · drizzle.config.ts · vitest*.config.ts · playwright.config.ts
          · eslint.config.mjs · postcss.config.mjs · tsconfig.json · sentry.*.config.ts
```

### API routes

Solo existen endpoints REST donde las Server Actions no aplican: autenticación,
descarga/subida de archivos, polling, exportación Excel, cron jobs e integración
externa TAE.

```
auth/[...nextauth]              attachments/[id]              notifications
health                          reportes/export              trazabilidad/export
bodega/stock/export             bodega/kardex/export          admin/catalogos/export
combustibles/import             purchase-orders/invoices/[id] flota/documentos/[id]
prevencion/documentacion/*      prevencion/pdtp/*             prevencion/ppa/export
prevencion/indicadores/export   repuestos/quotaciones/[id]    servicios/cotizaciones/[id]
soporte/adjuntos/[id]           tae/{access,identity,submit,evidence/[id]}
cron/{fuel-anomaly-detection,fuel-copec-sync,fuel-statement-notifications,
      operational-integrity-scan,pdtp-evidence-gc,pdtp-weekly-reminders,
      sst-weekly-alerts}
```

---

## Base de datos

PostgreSQL vía `postgres` con Drizzle ORM. Conexión por `DATABASE_URL`; un
singleton Drizzle previene múltiples clientes en HMR de desarrollo.

### Esquema (32 archivos en `db/schema/`)

| Archivo | Dominio |
|---|---|
| `users.ts` | Cuentas, invitaciones, roles, permisos, `user_roles`, `worksite_users` |
| `worksites.ts` | Faenas, proveedores, trabajadores |
| `products.ts` | Catálogo: categorías, productos, atributos, proveedores preferidos |
| `requests.ts` | Solicitudes de compra + ítems + atributos por ítem |
| `purchasing.ts` | Órdenes de compra, líneas, cotizaciones, aprobaciones |
| `receiving.ts` | Recepciones y líneas de recepción |
| `stock.ts` | `worksite_stock` (stock por faena), `inventory_movements` (kardex), entregas |
| `dispatch-guides.ts` | Guías de Despacho Internas (GDI): `dispatch_guides`, `dispatch_guide_items` — traslado Oficina → Faena, documento interno **no tributario** |
| `repuestos.ts` / `servicios.ts` | Solicitudes unificadas de repuestos y servicios |
| `sst.ts` / `ppa.ts` | Evaluaciones SST y Prevención de Peligros en el Área |
| `maintenance.ts` | Mantención de flota/equipos |
| `epp-imports.ts` | Importaciones de catálogo EPP |
| `fuel-*.ts` (11) | Combustibles: `invoices`, `suppliers`, `vehicles`, `products`, `operations`, `consumption`, `cycle`, `anomalies`, `review-marks`, `equipment-types`, `tae` |
| `feedback.ts` | Soporte / feedback interno |
| `audit.ts` | `audit_log`, `status_history`, `attachments` |
| `system-settings.ts` | `system_settings`, `notifications` |
| `clients.ts` | Dominio comercial: `clients`, `client_contacts`, `contracts` |
| `billing.ts` (12) | Facturación y cobranza: facturas normalizadas, ítems, referencias externas, vínculos operacionales, pagos, movimientos bancarios, gestiones de cobranza, propuestas, corridas de sincronización, eventos y candidatos a duplicado |
| `cost-centers.ts`, `email-templates.ts`, `code-sequences.ts`, `rate-limits.ts` | Soporte transversal |

Tipos de movimiento de kardex (CHECK en `inventory_movements`): `ingreso_oc`,
`egreso_entrega`, `ingreso_devolucion`, `egreso_desecho`,
`retiro_epp_trabajador`, `ajuste`, `egreso_traslado`, `ingreso_traslado`. Los
dos últimos son las patas de una Guía de Despacho Interna: el despacho
descuenta en la oficina (`egreso_traslado`) y abona en la faena de destino
(`ingreso_traslado`) en la misma transacción, ambos con
`reference_type = 'dispatch_guide'`.

> **Migraciones (regla crítica):** nunca editar `meta/_journal.json` a mano ni
> una migración `.sql` ya creada. Cambiar `db/schema/*.ts` y correr
> `npm run db:generate`. Usar `db:migrate` (no `db:push`) en BD con historial.
> Detalle completo en `db/migrations/README.md`.

---

## Ciclo de vida del ítem (máquina de estados)

El ítem —no la solicitud ni la OC— es la unidad central de control. Cada ítem
tiene estado independiente, lo que resuelve el problema de "ítems perdidos".

```
draft → requested ─┬─ approved → in_purchase_order → purchased
                   └─ rejected (terminal)              │
                                                       ▼
                              partially_received → received
                                                       │
                                                       ▼
                              partially_delivered → delivered (terminal)

                   ramas laterales:  postpone → postponed   ·   return → returned
```

**Solicitud:** `draft → submitted → in_review → partially_approved → approved →
in_purchasing → closed` (con `cancelled` / `returned` / `rejected` según flujo).

**Orden de compra:** `draft → issued → sent → partially_office_received →
office_received → partially_received → received → closed` (con `cancelled`).
Las etapas de oficina sólo aplican a las OC `via_oficina`; una OC
`directo_faena` va de `sent` a `partially_received`/`received`. El estado
`supplier_confirmed` se retiró en 2026-07-30: dejaba la OC fuera del conjunto
recibible y era imposible avanzarla (migración `0132`).

**Guía de Despacho Interna (GDI):** `draft → dispatched → received`, con
`cancelled` alcanzable desde los tres. No hay retorno faena → oficina: para eso
existiría otro documento. El despacho es el único paso que mueve stock
(descuenta en la oficina, abona en la faena); la recepción sólo sella quién
recibió y cuándo. La anulación de una guía que ya despachó agrega los
movimientos de reversa —nunca borra los originales— y se rechaza si la faena ya
consumió los bienes, para no dejar stock negativo.

---

## Autenticación y autorización

### NextAuth

- **Estrategia**: Credentials (email + contraseña) con JWT sessions.
- **Hashing**: bcrypt, cost factor 12.
- **Rate limiting**: persistente en Postgres, doble llave (IP + email). Bloquea
  tras N intentos fallidos consecutivos.
- **Registro**: el primer usuario obtiene rol `administrador`; el resto requiere invitación.

### RBAC — 15 roles

Fuente de verdad: `SYSTEM_ROLES` en `lib/auth/system-rbac.ts`.

| Rol | Visibilidad | Alcance |
|---|---|---|
| `administrador` | Todas las faenas | Control total |
| `jefa_chome` | Todas | Aprobar, comprar, recibir, despachar |
| `secretaria` | Todas | Aprobar, comprar, recibir, despachar |
| `prevencionista` | Todas | Jefa Dpto. Prevención de riesgos |
| `solicitante_faena` | Faenas asignadas | Crear y enviar solicitudes |
| `prevencionista_faena` | Faenas asignadas | Solicita EPP y servicios desde faena |
| `jefe_mantencion` | Todas | Gestión de mantención de flota/equipos |
| `conductor_lider` | Faenas asignadas | Evaluaciones SST de conductores |
| `admin_contrato` | Faenas asignadas | Administrador de contrato / supervisor de faena |
| `jefe_terreno` | Faenas asignadas | Jefe de terreno |
| `supervisor_terreno` | Faenas asignadas | Supervisor de terreno |
| `cphs` | Faenas asignadas | Comité Paritario de Higiene y Seguridad |
| `gerente_legal_rrhh` | Todas | Gerencia Legal y Recursos Humanos |
| `subgerente_operaciones` | Todas | Subgerente de operaciones |
| `tecnico_ti` | Todas | Técnico TI |

**271 permisos granulares** derivados del registry (`modules/registry.ts` vía
`modules/permissions.ts`). La lista completa vive en el registry, no se mantiene a mano.

### Guards

```typescript
can(user, "requests:create")                          // verificación simple
canAny(user, ["requests:view_own", "requests:view_all"])  // OR
await requirePermission("purchasing:create_order")    // server action guard (lanza)
await guardPermission("admin:users")                  // middleware de página
```

### Scoping por faena

Los usuarios con roles de faena solo ven datos de sus faenas asignadas
(`worksite_users`). El filtrado ocurre a nivel **SQL** (`WHERE worksiteId IN (...)`),
no en memoria, evitando fugas entre faenas. Caché RBAC de 60 s, invalidado en
cambios de perfil.

---

## Patrones y convenciones

### Server Actions

Las mutaciones son Server Actions dentro de `app/`. Cada acción:

1. Valida la sesión (`requirePermission` / `can`).
2. Valida la entrada con Zod.
3. Ejecuta en la BD dentro de una transacción.
4. Registra auditoría (`recordAudit`).
5. Revalida rutas afectadas (`revalidatePath`).
6. Retorna `{ success: true }` o `{ error: string }`.

No hay API REST para mutaciones (solo Server Actions). No hay estado global
(Redux/Zustand): React Query cachea el servidor, la sesión viene del
`SessionProvider`.

### Códigos y secuencias

Formato `{PREFIJO}-{AÑO}-{SECUENCIA}` (`SOL-2026-0042`, `OC-2026-0017`,
`REC-2026-0005`, `ENT-2026-0003`), generados con transacción atómica en
`lib/code-sequences.ts`.

Excepción: los prefijos de serie continua (`CONTINUOUS_CODE_PREFIXES` en
`lib/id.ts`) no llevan año — `SOL-0042` y `GDI-000001`. Su SEQUENCE nativa se
crea con año `0`, así que el folio nunca se reinicia.

### Auditoría

Cada mutación de estado se registra en dos tablas: `audit_log` (quién/qué/cuándo,
estado anterior/nuevo en JSON, motivo) y `status_history` (transición
fromStatus → toStatus).

### Adjuntos y storage

Los comprobantes se guardan en el filesystem bajo `storage/` (configurable con
`STORAGE_PATH`) y se referencian desde `attachments` con rutas **relativas**. La
API de descarga valida autenticación, permiso por faena y que la ruta quede
dentro del prefijo antes de leer.

Requisitos operativos con storage local:

- Montar `STORAGE_PATH`/`storage/` en un volumen persistente, no efímero.
- Incluir `storage/` en la política de backup junto con Postgres y restaurar
  ambos como unidad consistente.
- Para escalar horizontalmente, mover adjuntos a object storage.

---

## Decisiones arquitectónicas

1. **PostgreSQL como BD única** — migraciones Drizzle versionadas; apta para
   concurrencia operativa, E2E desechable y despliegues multiproceso.
2. **Per-item state tracking** — la unidad de control es el ítem, no la solicitud
   ni la OC. Resuelve "ítems perdidos".
3. **Sin API REST para mutaciones** — Server Actions; REST solo para auth,
   archivos, notificaciones, exportación Excel, cron y TAE.
4. **Sin estado global** — React Query + SessionProvider.
5. **Exportación solo Excel** — regla de proyecto, nunca CSV, siempre ExcelJS.
6. **Sin librería de animación externa** — transiciones CSS + Radix, respetando
   `prefers-reduced-motion`.
7. **Single-tenant, siempre claro** — una instalación por organización; sin
   multi-tenancy ni dark mode.

---

## Seguridad

- **Headers HTTP** (`next.config.ts`): `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` restringido, `Strict-Transport-Security`.
- **Rate limiting** persistente en Postgres (doble llave IP + email).
- **Validación** Zod en toda entrada de usuario (`masters.ts`, `operations.ts`).
- **Worksite scoping** en SQL, no en la capa de aplicación.

---

## Testing

| Capa | Herramienta | Ubicación |
|---|---|---|
| Unitario | Vitest 4 | `lib/__tests__/`, `components/__tests__/`, colocados |
| E2E | Playwright | `e2e/` |
| Cobertura | v8 (vitest) | Target `lib/**/*.ts` |

E2E con Postgres desechable, datos semilla fijos, puerto 3100. Correr con
`PGHOST=/var/run/postgresql` para evitar fallos de auth TCP.

---

## Comandos de build

```bash
npm install          # dependencias
npm run db:migrate   # aplica migraciones versionadas
npm run db:seed      # RBAC + faenas/trabajadores + catálogo EPP
npm run dev          # dev server en :3001
npm run build        # build de producción (output standalone)
npm start            # node .next/standalone/server.js
npm test             # unit tests (vitest)
npm run test:e2e     # E2E (scripts/run-e2e.sh)
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
```
