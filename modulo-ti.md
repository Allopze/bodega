# Módulo TI — Plataforma CHOME

## Estado de avance — actualizado 2026-11-08

> **Este documento reemplaza el estado del 2026-09-03.** Las secciones de fases y el detalle de la migración 0245 se conservan como historia; lo que sigue describe el módulo tal como está hoy. La auditoría vigente y sus hallazgos cerrados están en `AUDITORIA_MODULO_TI_2026-11-08.md`.

- **Navegación (3 grupos):** Seguimiento (Resumen `/ti`, Reportes TI `/ti/reportes`), Equipos (Inventario `/ti/activos`, Entregas `/ti/asignaciones`, Mantenciones `/ti/mantenciones`, Garantías y proveedores `/ti/garantias`, Bajas `/ti/bajas`), Servicios (Mesa de ayuda `/ti/tickets`, Accesos `/ti/accesos`, Licencias `/ti/licencias`).
- **Permisos:** 10, incluido `ti:reverse_retirement` (separado de `ti:manage_assets` para preservar el doble control de la baja; es permiso sensible de concesión).
- **Inventario:** página con búsqueda y paginación **en servidor** (`?q=`, `?pagina=`, `?orden=`), filtros estructurados y `ServerPagination`. La tabla no ordena en cliente.
- **Reparación:** registrar una mantención de tipo `reparacion` sobre un activo `disponible`/`en_bodega` lo deja `en_reparacion`. Un activo en custodia no se toca: para eso está la salida a reparación (`kind: repair_exit`).
- **Reparación demorada:** umbral único de **14 días** en tablero, cron y filtro `?reparacion=demorada`, medido desde el último movimiento del historial (no `updatedAt`).
- **Adjuntos:** tope de **50 por activo**, 25 MB por archivo y **30 cargas/hora por usuario** en `POST /api/ti/attachments`. Sigue siendo append-only (sin borrado).
- **Migraciones:** 0245 (17 tablas `it_*`) + **0382** (índice único `lower(name)` en `it_asset_types`). Cadena verificada con `npm run db:verify-migrations`.
- **Estado de verificación:** `typecheck` y `lint` en verde; pruebas PGlite de TI en verde; recorrido autenticado en navegador de las 10 rutas sin errores de consola, sin overflow y sin violaciones axe graves. Ver `AUDITORIA_MODULO_TI_2026-11-08.md` para el detalle.

### Fase 1 — core

- [x] Schema `db/schema/ti.ts` (17 tablas `it_*`).
- [x] **Migración `db:generate` + `db:migrate`** — ✅ **0245_round_paper_doll.sql** generada (17 tablas `it_*`, solo TI, sin tocar el journal) y **aplicada a la base de desarrollo 2026-09-03** (verificado: las 17 tablas existen). Cadena verificada y re-generar reporta "No schema changes".
- [x] Validación zod `lib/validation/ti.ts`.
- [x] Servicios `lib/services/ti/` (14 archivos: constants, history, assets, asset-types, assignments, assignment-photos, maintenance, retirements, tickets, licenses, access, supplier-links, alerts, queries).
- [x] Manifest + registry + área nav + rol `tecnico_ti` + storage prefijo `ti` (RBAC auto-derivado del manifest).
- [x] Inventario: página, filtros, tabla, alta de activo (`/ti/activos` + `asset-form-sheet.tsx`).
- [x] Dashboard TI (`/ti`: 4 KPI accionables + SummaryBar + gráficos Recharts).
- [x] Ficha de activo con tabs — ✅ **implementado** (estaba "in progress"): `activos/[id]/page.tsx` + `asset-detail-tabs` con resumen, asignaciones, mantenciones, tickets, documentos, historial y control de estado.
- [x] Asignaciones: entrega, devolución, transferencia, fotos, comparación — ✅ **implementado**: `asignaciones/` (assignment-sheet, return-sheet, tabla, actions con `createAssignment`/`returnAssignment`/`transferAssignment`) + `/api/ti/photos` + comparación entrega/devolución en la ficha.
- [x] Acta entrega/devolución: página print + PDF — ✅ **implementado**: `app/(print)/ti/actas/[assignmentId]/print/` (página + PDF server-side vía Chromium pool + PrintTrigger + filename).
- [x] Mantenciones y reparaciones (`/ti/mantenciones` + panel en la ficha).
- [x] Bajas de activos — ✅ **implementado** (estaba ☐): `/ti/bajas` (retirement-sheet + tabla + actions).
- [x] Garantías y proveedores TI — ✅ **implementado** (estaba ☐): `/ti/garantias` (warranty-table + supplier-links-panel + actions).
- [x] Reportes básicos con export Excel — ✅ **implementado** (estaba ☐): `/ti/reportes`, 9 reportes `.xlsx` con permiso `ti:export`.

### Fase 2 — soporte/software (implementado, sin cerrar)

- [x] Tickets: listado + ficha `[id]` + comentarios (internos con `ti:comment_internal`) + transiciones + adjuntos.
- [x] Licencias: compradas/asignadas/disponibles + asignaciones a trabajador/equipo/área/faena.
- [x] Accesos: sistemas configurables + checklists alta/baja + matriz trabajador × sistema.
- [x] Alertas cron: `/api/cron/ti-alerts` (verifyCronSecret + withCronLock) + job `ti-alerts` en `cron-runner.mjs`.

### Tests y cierre — ✅ ejecutado 2026-09-03

- [x] **3 errores de TypeScript** (acciones `useActionState` en `<form action>` plano): corregidos con el patrón del repo (`useActionState` + `INITIAL_STATE`, ver `admin/usuarios/user-list.tsx`) en `accesos/access-systems-panel.tsx`, `accesos/checklists-panel.tsx` y `licencias/license-panel.tsx`. `npm run typecheck` en verde.
- [x] **Bugs de runtime detectados y corregidos** (los tests los destaparon):
  - SQL crudo consultaba `u.first_name`/`u.last_name`, pero `users` solo tiene columna `name` (3 archivos: assignment-photos, assignments, maintenance).
  - Sumas de dinero con `coalesce(sum(...), 0)` sin `::float8` devolvían string numérico (patrón del repo: `::float8`; 6 puntos en assets, maintenance, queries, supplier-links, reportes).
  - Subconsulta correlacionada en `listAccessSystems` (sin JOIN) que drizzle renderizaba sin calificar → `accessCount` siempre 0; corregido con alias explícito (convención `stock-documents.ts`).
  - `text()` zod rechazaba `null` → el alta de activo fallaba cuando el tipo no aplica specs (campos ausentes del form); ahora acepta `null` (los consumidores ya normalizaban con `?.trim() || null`).
  - `reportes/actions.ts` usaba `new Date().toISOString().slice(0,10)` (día UTC); ahora `todayInChile()`.
  - **Inventario de module-toggles**: las 4 rutas API TI (`/api/ti/photos`, `/api/ti/photos/[id]`, `/api/ti/attachments/[id]`, `/api/cron/ti-alerts`) no resolvían dueño de módulo → apagar TI no las cerraba y la prueba de cobertura fallaba; agregados a `ROUTE_OWNER_ALIASES`.
- [x] **Tests PGlite** (52 tests, 6 archivos, registrados en `tests/pglite-files.ts`): `ti-assets-pglite`, `ti-assignments-pglite`, `ti-tickets-pglite`, `ti-licenses-access-pglite`, `ti-maintenance-retirement-pglite`, `ti-alerts-pglite`.
- [x] **Tests unit + actions** (21 tests): `ti-validation.test.ts` + `ti-actions.test.ts` (permisos, validación, errores seguros).
- [x] **e2e Playwright**: `e2e/ti-modulo.spec.ts` (dashboard, inventario con fixture, tickets, reportes, guard de autorización sin `ti:view` → `/forbidden`) + fixtures TI en `e2e/setup-db.ts` (tipo `Notebook`, activo `TI-E2E-0001`, ticket `INC-E2E-0001`). ✅ **Ejecutado 2026-09-03: 5/5 passed** contra el contenedor e2e desechable (`bodega-e2e-postgres`, reset destructivo permitido).
- [x] **Build roto pre-existente desbloqueado**: `next build` fallaba porque `campanas-client.tsx` (cliente) importaba `PDTP_CAMPAIGN_ACTIVITIES` desde `prevention-campaigns.ts`, que arrastra `@/db`→`postgres` al bundle del navegador (commiteado, ajeno a TI). Fix de capa: catálogo movido a `lib/services/prevention-campaigns.catalog.ts` (seguro para cliente) y re-exportado desde el servicio.
- [x] **`npm run lint` en verde** (0 problemas; se limpiaron ~40 warnings de imports/vars sin uso y el `no-img-element` del acta con la convención del repo).
- [x] Verificación: `tsc` ✅, `lint` ✅, PGlite TI 52/52 ✅ + unit 21/21 ✅ + module-toggles 27/27 ✅ (tras el fix de inventario), `db:verify-migrations` ✅ (250 entradas), `db:generate` "No schema changes" ✅.

### Pendiente real (2026-11-08)

- [x] **Base de desarrollo**: 17 tablas `it_*`, rol `tecnico_ti` y grants `ti:*` aplicados; migración 0382 pendiente de aplicar donde corresponda (el archivo y el checksum ya están en el repo).
- [x] **Verificación en navegador** de las 10 rutas `/ti` con una sesión autenticada: sin errores de consola, sin overflow en 1440/1024/390 y sin violaciones axe `serious`/`critical`.
- [ ] **`npm run test:e2e` completo**: `e2e/ti-modulo.spec.ts` existe y cubre resumen, inventario, tickets, reportes y el guard de `ti:view`; no se ejecutó la suite E2E completa en esta pasada.
- [ ] **Rendimiento del catálogo de proveedores**: la consulta ya no es 4 × N correlacionada, pero el panel sigue sin paginar (catálogo pequeño por diseño).
- [ ] **Commit**: los cambios del 2026-11-08 están en el worktree, sin commit al cierre de este documento.

## Decisiones de diseño (confirmadas)

1. **Dos fases**: Fase 1 = activos, asignaciones, evidencia fotográfica, actas, historial, mantenciones, garantías, dashboard, reportes básicos. Fase 2 = tickets, licencias, accesos, checklists alta/baja, alertas cron, reportes completos.
2. **Acta de entrega/devolución**: mismo mecanismo del repo para documentos — route group `app/(print)/` + PDF server-side vía `lib/pdf/browser-pool.ts` (Chromium pool, patrón exacto de OC y guías de despacho). No se agregan dependencias.
3. **Aceptación del trabajador**: registrada por el técnico TI (sin firma manuscrita). El acta consigna "Aceptado por trabajador — confirmado por {técnico TI}" con fecha/hora.
4. **Trabajadores sin cuenta**: NO hay portal público. Los tickets los crea un representante con cuenta en la faena (admin de contrato, jefe de terreno, supervisor). El ticket guarda `requesterUserId` (quien crea) + `workerId` (trabajador afectado).
5. **Códigos**: activo = código interno manual (`TI-NB-0042`, único). Tickets = `nextCodeTx(tx, "INC", year)` → `INC-2026-0001`. Actas = `nextCodeTx(tx, "ACT", year)` → `ACT-2026-0001`. Mantenciones y bajas no llevan correlativo.
6. **Estados de activo NO configurables** (son máquina de flujo con lógica de sincronización). Lo configurable es el **catálogo de tipos de activo**.
7. **Fotos sin comprimir** (evidencia probatoria), máx 25 MB, validación por magic bytes (`validateFileBuffer`, `MimeType.IMAGE`). Miniaturas = escala CSS + lightbox (patrón TAE `evidence-thumbnail.tsx`); el repo no genera thumbnails persistidos.

## Reutilización (nada de sistemas paralelos)

| Recurso | Reutilizar | Ubicación |
|---|---|---|
| Trabajadores/faenas/proveedores | `workers`, `worksites`, `suppliers` | `db/schema/worksites.ts` |
| Usuarios (responsables, técnicos) | `users` | `db/schema/users.ts` |
| Archivos genéricos | `attachments` (polimórfica `entity_type`/`entity_id`) | `db/schema/audit.ts` |
| Auditoría | `audit_log` + `recordAudit` / `recordStatusChange` | `lib/audit.ts` |
| Historial de estados | `status_history` (entityType `it_ticket`) | `db/schema/audit.ts` |
| RBAC | manifest + registry + `requirePermission`/`can`/`canAny` + scope | `modules/`, `lib/auth/` |
| Scope por faena | `worksiteScopeSql`, `serviceWorksiteScope`, `canAccessWorksite` | `lib/auth/scope.ts` |
| Notificaciones/alertas | `createNotifications`, `getUserIdsWithPermission`, `notifyAfterCommit` | `lib/services/notifications.ts` |
| Cron | route `/api/cron/*` con `verifyCronSecret` + `withCronLock`, runner | `app/api/cron/`, `scripts/cron-runner.mjs` |
| Fotos/upload | `lib/storage/` (nuevo prefijo `storage/ti/`), `validateFileBuffer` | `lib/storage/config.ts`, `lib/file-validation.ts` |
| PDF | `app/(print)/` + `withBrowserContext` + `a4PdfOptions` + `PrintTrigger` | `app/(print)/compras/[id]/print/` |
| Export Excel | `ExportButton`/`ExportDialog` + `buildXlsxBuffer`/`xlsxToBase64` (ExcelJS) | `lib/reports/export-module/`, `components/ui/` |
| UI | `DataTable`, `KpiCard`, `Tabs`, `Sheet`, `Dialog`, `Field`, `EmptyState`, `StateBadge`, `EntityTimeline`, `DatePicker`, `Badge`, `PageHeader`, `PageContainer`, `ConfirmDialog`, `FilterToolbar` | `components/ui/`, `components/states/` |
| Códigos correlativos | `nextCodeTx` (SEQUENCE nativa `next_document_code`) | `lib/code-sequences.ts` |
| IDs | `nanoid()` | `lib/id.ts` |
| Formularios | `useActionState` + `ActionState` + `parseZ` | `lib/validation/masters.ts`, `lib/actions/parse-z.ts` |
| Errores | `safeActionMessage` | `lib/action-error.ts` |
| Fechas | `todayInChile`, `formatDate`, `formatCLP` | `lib/utils.ts` |

## Modelo de datos — `db/schema/ti.ts` (nuevo)

Convenciones: `pgTable` snake_case, PK `text`, enums como `text` + `check`, `numeric(14,2) mode:"number"` para dinero, `createdAt/updatedAt` con `withTimezone mode:"string" defaultNow()`, índices por FK y por columna de filtro.

1. **`it_asset_types`** — catálogo configurable: `id, name, category` (check: `computacion|periferico|red|telefonia|movilidad|almacenamiento|otro`), `hasSpecs` (boolean: aplican CPU/RAM/disco/OS), `isActive, createdAt, updatedAt`.
2. **`it_assets`** — `id, code` (unique), `assetTypeId` FK, `brand, model, serialNumber` (unique nullable), `status` (check: `disponible|asignado|en_prestamo|en_reparacion|en_bodega|dado_de_baja|perdido|robado`), `workerId` FK nullable (custodio actual, denormalizado y sincronizado por asignaciones), `worksiteId` FK nullable (faena actual), `location` (texto libre: oficina/bodega/detalle), `purchaseDate, supplierId` FK nullable, `purchaseDocType` (`factura|oc|otro`) + `purchaseDocRef`, `cost` numeric, `warrantyEndDate`, `processor, ram, storage, os` (nullable, solo si el tipo tiene `hasSpecs`), `observations, deletedAt` (soft delete, patrón `purchase_orders`), `createdAt, updatedAt`. Índices: `code, status, workerId, worksiteId, assetTypeId, supplierId, warrantyEndDate, deletedAt`.
3. **`it_asset_assignments`** — custodia: `id, code` (correlativo ACT), `assetId` FK, `workerId` FK, `worksiteId` FK, `kind` (`delivery|loan|transfer|repair_exit`), `deliveredAt, deliveredByUserId` FK, `physicalState` (check: `bueno|regular|malo|nuevo`), `observations, acceptedAt, acceptedByUserId` FK (técnico TI que confirma aceptación), `returnedAt, returnedByUserId` FK, `returnPhysicalState, returnObservations, createdAt, updatedAt`. Una asignación activa por activo (índice parcial unique sobre `assetId` donde `returnedAt IS NULL`).
4. **`it_assignment_accessories`** — `id, assignmentId` FK cascade, `name, returnedAt` nullable.
5. **`it_assignment_photos`** — `id, assignmentId` FK cascade, `stage` (`delivery|return`), `fileName, filePath, fileSize, mimeType, uploadedByUserId` FK, `caption, createdAt`. NUNCA se borran al subir nuevas.
6. **`it_asset_history`** — timeline append-only: `id, assetId` FK, `action` (check: `created|assigned|returned|status_changed|edited|maintenance|ticket|document|photo|warranty|retired`), `detail, changes` (JSON string), `actorUserId` FK, `createdAt`. Índice `(assetId, createdAt)`.
7. **`it_maintenances`** — `id, assetId` FK, `type` (`preventiva|correctiva|reparacion|actualizacion|revision`), `date, reportedIssue, diagnosis, workDone, partsUsed`, `supplierId` FK nullable, `technicianName` (texto libre, puede ser externo) + `technicianUserId` FK nullable, `cost` numeric default 0, `observations, createdAt, updatedAt`. Métricas (costo acumulado, cantidad, última fecha) se calculan con `sum/count/max`, no se persisten.
8. **`it_tickets`** — `id, code` (INC correlativo), `subject, description, category` (check: `hardware|software|correo|internet|impresoras|telefonia|accesos|plataforma|cuentas|otro`), `priority` (`baja|normal|alta|critica`), `status` (`nuevo|asignado|en_diagnostico|en_progreso|esperando_usuario|esperando_proveedor|resuelto|cerrado`), `requesterUserId` FK (quien crea), `workerId` FK nullable (trabajador afectado), `worksiteId` FK, `assetId` FK nullable, `assigneeUserId` FK nullable, `resolvedAt, resolution, createdAt, updatedAt`. Índices: `status, worksiteId, assigneeUserId, requesterUserId, assetId, createdAt`.
9. **`it_ticket_comments`** — `id, ticketId` FK cascade, `body, authorUserId` FK, `isInternal` default false, `createdAt`.
10. **`it_licenses`** — `id, name, supplierId` FK nullable, `type, purchasedQuantity` default 0, `cost` numeric, `periodicity` (`mensual|anual|unica`), `startDate, renewalDate, responsibleUserId` FK, `notes, isActive, createdAt, updatedAt`.
11. **`it_license_assignments`** — `id, licenseId` FK cascade, `workerId` nullable, `assetId` nullable, `area` (texto libre) nullable, `worksiteId` nullable, `assignedAt, revokedAt, notes`. Check: al menos un destino.
12. **`it_access_systems`** — catálogo configurable de sistemas (Microsoft 365, VPN, Chipax…): `id, name, description, isActive, createdAt, updatedAt`.
13. **`it_system_access`** — `id, systemId` FK, `workerId` FK, `status` (`activo|suspendido|baja`), `grantedAt, revokedAt, responsibleUserId` FK, `notes, createdAt, updatedAt`. Unique `(systemId, workerId)`.
14. **`it_worker_checklists`** — alta/baja: `id, workerId` FK, `kind` (`onboarding|offboarding`), `startedAt, completedAt, createdByUserId` FK, `notes, createdAt`.
15. **`it_checklist_tasks`** — `id, checklistId` FK cascade, `name, done` default false, `doneAt, doneByUserId` FK, `notes`. Los nombres se instancian desde una plantilla constante al crear el checklist (queda histórico aunque la plantilla evolucione).
16. **`it_asset_retirements`** — `id, assetId` FK, `date, reason` (check: `venta|reciclaje|destruccion|repuesto|donacion|perdida|robo`), `responsibleUserId` FK, `authorizedByUserId` FK, `destination, observations, createdAt`.
17. **`it_supplier_links`** — marca proveedores existentes como TI sin tocar `suppliers`: `id, supplierId` FK cascade, `category` (check: `reparacion|venta_hardware|licencias|telefonia|internet|cloud|otro`), `notes, createdAt`. Unique `(supplierId, category)`.

Adjuntos genéricos vía `attachments` con entityType: `it_asset`, `it_assignment`, `it_maintenance`, `it_ticket`, `it_retirement`, `it_license`.

Migración: solo `npm run db:generate` (nunca editar `_journal.json`). ✅ **0245_round_paper_doll.sql** (17 tablas `it_*`) generada y **aplicada a la base de desarrollo 2026-09-03**; cadena verificada y sin "schema changes" pendientes. Sin SQL custom necesario.

## Permisos y roles

Manifest `modules/ti/manifest.ts` con id `ti`:

- `ti:view` — ver dashboard, inventario, fichas, asignaciones, mantenciones, garantías.
- `ti:manage_assets` — crear/editar activos, asignaciones, devoluciones, bajas, catálogo de tipos.
- `ti:manage_maintenance` — crear/editar mantenciones.
- `ti:manage_tickets` — asignar, comentar (no internas), transicionar, resolver tickets.
- `ti:create_ticket` — crear tickets a nombre de un trabajador (representantes de faena).
- `ti:comment_internal` — notas internas en tickets (solo TI).
- `ti:manage_licenses` — licencias, suscripciones y asignaciones.
- `ti:manage_access` — sistemas, accesos por trabajador, checklists.
- `ti:export` — exportar reportes.
- `ti:reverse_retirement` — revertir una baja equivocada. **No** se concede a `tecnico_ti`: si quien registra la baja bajo doble control pudiera revertirla solo, el control quedaría anulado.

`defaultGrants`:
- **Nuevo rol `tecnico_ti`** (global, se agrega a `SYSTEM_ROLES` + `ROLE_ID_BY_SLUG` en `lib/auth/system-rbac.ts`): `ti:view`, `ti:manage_assets`, `ti:manage_maintenance`, `ti:manage_tickets`, `ti:comment_internal`, `ti:manage_licenses`, `ti:manage_access`, `ti:export`.
- `administrador`: todos (automático vía system-rbac).
- `jefa_chome`: `ti:view`, `ti:export`, `ti:reverse_retirement`.
- `subgerente_operaciones`: `ti:view`, `ti:export`.
- `admin_contrato`, `jefe_terreno`, `supervisor_terreno`: `ti:create_ticket` (scoped por faena).
- `secretaria`: `ti:create_ticket`.

Registro: 1 línea en `modules/registry.ts`. Área nueva `ti` en `components/layout/areas.ts` (icono Phosphor de `nav-icons.tsx`, agregar entrada si no existe). Seed: `npm run db:sync-rbac` (o `db:seed`).

Patrón de scope en todas las queries TI: `worksiteScopeSql(session, columna)` sobre `assets.worksiteId`/`assignments.worksiteId`/`tickets.worksiteId`. Licencias son globales, sin scope. Roles globales ven todo; `tecnico_ti` es global; representantes de faena solo su faena. Fugas de info → `notFound()` (patrón compras).

## Estructura de rutas y archivos

```
db/schema/ti.ts
lib/validation/ti.ts                          # zod, mensajes en español
lib/services/ti/
  index.ts, types.ts, constants.ts            # labels de estados/categorías (StateBadge-style)
  assets.ts, asset-types.ts                   # CRUD activos, catálogo tipos
  assignments.ts, assignment-photos.ts        # entrega/devolución/transferencia, fotos
  history.ts                                  # append a it_asset_history + recordAudit
  maintenance.ts
  retirements.ts
  tickets.ts
  licenses.ts
  access.ts, checklists.ts
  guarantees.ts, supplier-links.ts
  alerts.ts                                   # cron diario
  queries.ts                                  # agregados dashboard/reportes
  acts.ts                                     # datos del acta para la página print
modules/ti/manifest.ts
components/layout/areas.ts                    # + área "ti"
app/(app)/ti/
  page.tsx                                    # dashboard
  activos/page.tsx, activos/actions.ts, activos/activos-filters.tsx, activos/activos-table.tsx
  activos/[id]/page.tsx, activos/[id]/asset-detail-tabs.tsx, asset-*.tsx (paneles)
  asignaciones/page.tsx, asignaciones/actions.ts, asignaciones/assignment-sheet.tsx
  mantenciones/page.tsx, mantenciones/actions.ts
  bajas/page.tsx, bajas/actions.ts
  tickets/page.tsx, tickets/actions.ts, tickets/[id]/page.tsx
  licencias/page.tsx, licencias/actions.ts
  accesos/page.tsx, accesos/actions.ts
  garantias/page.tsx, garantias/actions.ts    # proveedores TI + garantías
  reportes/page.tsx, reportes/export-menu.tsx
app/api/ti/photos/route.ts                    # POST multipart (asignación+stage+caption)
app/api/ti/photos/[id]/route.ts               # GET autenticado, anti-IDOR
app/api/ti/attachments/route.ts               # POST multipart (25 MB, 30/hora, tope 50 por activo)
app/api/ti/attachments/[id]/route.ts          # GET adjuntos genéricos
app/api/cron/ti-alerts/route.ts               # verifyCronSecret + withCronLock
app/(print)/ti/actas/[assignmentId]/print/page.tsx, acta-styles.ts, print-trigger.tsx, filename.ts
app/(print)/ti/actas/[assignmentId]/print/pdf/route.ts   # withBrowserContext (patrón OC)
```

Navegación (manifest `nav`, areaId `ti`, tres grupos contiguos): **Seguimiento** — Resumen `/ti`, Reportes TI `/ti/reportes`; **Equipos** — Inventario `/ti/activos`, Entregas `/ti/asignaciones`, Mantenciones `/ti/mantenciones`, Garantías y proveedores `/ti/garantias`, Bajas `/ti/bajas`; **Servicios** — Mesa de ayuda `/ti/tickets`, Accesos `/ti/accesos`, Licencias `/ti/licencias`.

## Flujos clave

### Inventario
- `PageHeader` + filtros server-side por `searchParams` (tipo, estado, trabajador, faena, proveedor, garantía, antigüedad, `reparacion=demorada`) con `FilterToolbar`. La búsqueda (`?q=`) y el orden (`?orden=codigo|codigo_desc|activo|faena|garantia|reciente`) también viajan en la URL y se resuelven en `listAssets`/`countAssets`; la página usa `ServerPagination` (`?pagina=`). La ruta está en `ROUTES_WITH_OWN_SEARCH`, así que el TopBar no muestra un segundo buscador. Los agregados de mantención/tickets salen de subconsultas agrupadas, no correlacionadas por fila.
- Alta de activo: `Sheet` (patrón `catalog-form-sheet`) con `Field`, `DatePicker`; specs solo si el tipo tiene `hasSpecs`. Validación server (zod) + client. Código interno manual único.
- Ficha `/ti/activos/[id]` con tabs sincronizadas a `?tab=` (patrón `oc-detail-tabs`): **Resumen** (datos, badge estado, custodio, garantía, costo, costo acumulado reparaciones, #mantenciones, #tickets), **Asignaciones**, **Mantenciones**, **Tickets**, **Documentos**, **Fotografías**, **Historial** (`EntityTimeline` + `it_asset_history`).
- Cambio de estado: `ConfirmDialog` con motivo; `recordAudit` (old/new) + `recordStatusChange` + fila en `it_asset_history`. Nunca sobrescribir.

### Asignación / custodia / fotos / acta
1. `assignment-sheet.tsx` (Sheet, no modal anidado): activo, trabajador, faena, fecha/hora, estado físico, accesorios (chips dinámicos), observaciones, fotos de entrega (upload multi con preview antes de crear).
2. Server action: zod → transacción (validar activo no asignado, insertar assignment + accesorios + fotos ya persistidas, actualizar `asset.status='asignado'`/`workerId`/`worksiteId`, `it_asset_history` + `recordAudit`) → `revalidateOperationalViews`-equivalente para `/ti/*`.
3. Fotos: upload via route `POST /api/ti/photos` (fetch multipart desde el cliente, patrón inspecciones) o server action con FormData (patrón entregas); `validateFileBuffer(bytes, size, MimeType.IMAGE)`, `generateStorageName`, `writeBuffer` a `storage/ti/`, registro en `it_assignment_photos` con `stage`. Las de devolución se suben en el momento de devolver, `stage='return'`.
4. **Comparación visual** en la ficha de asignación: grilla "Entrega" vs "Devolución" con lightbox (patrón `evidence-thumbnail.tsx`). Las fotos históricas persisten siempre.
5. **Acta** (entrega Y devolución, misma página print): identificación del trabajador, activo (marca/modelo/serie/código), accesorios, estado físico, observaciones, fecha, responsable TI, aceptación confirmada por técnico TI. PDF descargable vía Chromium pool + botón imprimir. Enlazada desde la asignación y desde el historial del activo.
6. Devolución: acción en asignación activa → fotos de devolución + estado físico + accesorios devueltos + observaciones → cierra `returnedAt`, activo vuelve a `disponible` (o `en_bodega`). Transferencia = devolver + nueva entrega (o action dedicada que hace ambas en una transacción).

### Mantenciones
Registro con `reportedIssue/diagnosis/workDone/partsUsed/supplierId/technician/cost` + adjuntos (`attachments`). Panel en ficha del activo con: costo acumulado, #repeticiones, última mantención. Dashboard: ranking "mayor gasto acumulado" (señal de reemplazo). Una mantención de tipo `reparacion` sobre un activo `disponible` o `en_bodega` lo deja `en_reparacion` y lo registra en historial/`status_history`; sobre un activo en custodia no cambia el estado (se usa la salida a reparación).

### Bajas
`ConfirmDialog` con motivo/razón + responsable + autorizado por + destino + fotos/docs → inserta `it_asset_retirements`, setea `status='dado_de_baja'` (o `perdido`/`robado` según reason), historial + auditoría. El activo y su timeline quedan intactos para siempre.

### Garantías y proveedores
`/ti/garantias`: lista de activos con ventanas (vigente/por vencer 30-60-90/vencida) filtrables; proveedores TI vía `it_supplier_links` sobre `suppliers` existentes, con resumen por proveedor (activos, reparaciones, licencias, costos, documentos vía `attachments`).

### Dashboard `/ti`
- 4 `KpiCard` accionables (href con filtro): activos totales, asignados, en reparación, garantías por vencer. Métricas secundarias en `SummaryBar`/tira compacta (tickets abiertos, licencias por renovar, gasto TI del período).
- Gráficos Recharts lazy (`next/dynamic` + `ChartErrorBoundary`): activos por tipo, activos por faena, estado de activos, gasto de reparación por mes, antigüedad del parque. Doble eje cuando mezcle conteos y dinero (regla A5b).
- Alertas (`EmptyState` con CTA si no hay datos). Sin filas decorativas.

### Tickets (Fase 2)
- Creación: Sheet. `requesterUserId` = usuario logueado; `workerId` opcional (trabajador afectado, elegido por faena). Representantes scoped solo su faena; TI y jefatura global ven todo.
- Transiciones de estado + comentarios (con `isInternal` solo visible con `ti:comment_internal`). `status_history` (entityType `it_ticket`) + `audit_log` por cambio. Ficha `/ti/tickets/[id]` con timeline y adjuntos.
- Columnas de gestión: SLA "sin actualización" (updatedAt) para alertas.

### Licencias y accesos (Fase 2)
- Licencias: "Compradas / Asignadas / Disponibles" calculado; asignación a trabajador/dispositivo/área/faena (al menos un destino, check + zod).
- Accesos: catálogo `it_access_systems` (CRUD sheet); matriz trabajador × sistema con estado, alta/baja, responsable. Checklists alta/baja instanciados desde plantilla constante; marcado con `done` + `doneBy` + fecha.

### Alertas cron (Fase 2)
`app/api/cron/ti-alerts/route.ts` diario 6:45 (crontab docker-compose + job `ti-alerts` en `cron-runner.mjs`):
- Garantías: vencen en ≤30/≤60/≤90 días.
- Licencias: renuevan en ≤14 días **o ya están vencidas** (el caso más urgente).
- Activos: `en_reparacion` hace más de **14 días**, medido desde el último movimiento del historial (mismo predicado que el tablero y el filtro `?reparacion=demorada`).
- Tickets: abiertos sin `updatedAt` > 5 días.
Notificaciones in-app a usuarios con `ti:view` (`getUserIdsWithPermission`), `dedupeKey` `ti:<tipo>:<id>:<día>`.

### Reportes
`/ti/reportes`: lista con `ExportDialog`/`ExportButton` usando `buildXlsxBuffer`/`xlsxToBase64`: inventario general, por faena, equipos por trabajador, disponibles, en reparación, historial de un activo, costo de reparación por activo, antigüedad, garantías por vencer, licencias y asignaciones, tickets por período/faena/categoría, gasto TI. Auditoría `action:"export"` en cada export.

## UI / UX

- Todo con `PageHeader` + `PageContainer` + `Breadcrumbs`; tablas con `DataTable`; acciones de página en `PageHeader.actions` (reglas A1–A6). Estados con `StateBadge` (nueva familia `it-asset`/`it-ticket` en `components/states/state-badge.tsx`), textos `-ink` para warning/signal.
- Forms en Sheet/Dialog (nunca formulario permanente; excepción captura repetitiva no aplica). `useActionState` en `<form action>`; `useOperation` solo para handlers imperativos.
- Estados vacíos con `EmptyState` + CTA real. Loading con skeleton. Errores con `safeActionMessage` + toast (`@/lib/toast`).
- Fotos: `FileInput`/dropzone con preview, lightbox, `object-cover` thumbnails, sin compresión.

## Fases

### Fase 1 (core)
Schema completo (todo `ti.ts` de una vez, una migración). Manifest + registry + área + rol `tecnico_ti`. Catálogo de tipos. Inventario + ficha con tabs + historial. Asignaciones + fotos + actas (print + PDF) + devolución/transferencia. Mantenciones. Bajas. Garantías/proveedores. Dashboard. Reportes básicos (inventario, faena, trabajador, reparaciones, garantías). Tests + e2e.

### Fase 2 (soporte/software)
Tickets (listado + ficha + comentarios + SLA). Licencias + suscripciones + asignaciones. Accesos + sistemas configurables + checklists alta/baja. Alertas cron + runner + crontab. Reportes completos (tickets, licencias, gasto TI). Tests + e2e.

## Tests

- ✅ **PGlite**: `ti-assets-pglite` (incluye paginación, orden y filtro de reparación demorada), `ti-assignments-pglite` (una asignación activa por activo, fotos históricas, devolución/transferencia atómicas, fechas no invertidas, trabajador inactivo), `ti-tickets-pglite`, `ti-licenses-access-pglite` (cupos globales y fecha de revocación preservada), `ti-maintenance-retirement-pglite` (mantención mueve a reparación, protecciones del retirado, proveedores acotados), `ti-asset-types-pglite` (unicidad case-insensitive), `ti-alerts-pglite` y `ti-attention-and-reports` (mismo umbral de reparación y cupos globales).
- ✅ **Unit + Actions**: `ti-validation.test.ts` y `ti-actions.test.ts` (permisos, validación, errores seguros).
- ✅ **e2e**: `e2e/ti-modulo.spec.ts` + fixtures TI en `e2e/setup-db.ts`.
- ⏳ **Componentes**: tabs de ficha, `assignment-sheet` (testing-library) — pendiente.

## Verificación (Definition of Done)

1. ✅ `npm run typecheck` y `npm run lint` — en verde al 2026-11-08.
2. ✅ Migraciones 0245 + **0382** (`it_asset_types_name_lower_unique`); `npm run db:verify-migrations` en verde y checksums actualizados.
3. ✅ `npm run db:sync-rbac` (rol `tecnico_ti` + 10 grants `ti:*`, incluido `ti:reverse_retirement` solo para quien corresponde).
4. ✅ Pruebas PGlite de TI en verde (servicios, acciones y reportes).
5. ✅ Recorrido autenticado en navegador de las 10 rutas `/ti`: 0 errores de consola, 0 overflow horizontal en 1440/1024/390 y 0 violaciones axe `serious`/`critical`.
6. ⏳ `npm run test:e2e` completo (el spec de TI existe; no se ejecutó la suite completa en esta pasada).
7. ⏳ Permisos por rol en un entorno con usuarios reales: `tecnico_ti` completo, jefatura de faena acotada, representante solo crea tickets, sin permiso → `/forbidden`.

## Riesgos / notas

- El worktree ya tiene cambios PDTP sin commitear (migraciones 0241/0242). Trabajar sin tocar esos archivos; commits atómicos por dominio al cerrar.
- `tecnico_ti` global: si más adelante se quiere scope por faena, `isGlobal:false` + `worksite_users` (sin cambios de schema).
- Áreas de licencia como texto libre en v1 (no confundir con `cost_centers`, que es para costos de mantención/flota).
- No implementar: descubrimiento automático, agentes, MDM, red, SIEM (fuera de alcance).
