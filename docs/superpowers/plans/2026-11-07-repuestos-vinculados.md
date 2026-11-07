# Repuestos vinculados al equipo y a la OT — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una solicitud de repuestos (y de servicios) apunte a un vehículo de la flota y, opcionalmente, a una OT; que nazca desde la OT; que su costo llegue a Control operacional y a la ficha del equipo; y que la regla de 3 cotizaciones tenga un umbral por monto.

**Architecture:** Se agregan tres columnas a `purchase_request_items` (`vehicle_id`, `work_order_id`, `estimated_unit_price`) y todo lo demás se cuelga de ellas: el formulario de solicitud gana un selector de flota, la OT lee las solicitudes vinculadas (sin tocar su propio modelo), Control operacional y las fichas suman las OC por vehículo con un agregado nuevo modelado sobre `getAssetFuelSummary`, y la regla de cotizaciones se centraliza en una función pura usada por servidor y cliente.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Drizzle + Postgres (migraciones generadas), Vitest (PGlite para servicios), Playwright (E2E).

**Spec:** `qa/reports/revision-flujo-oc-repuestos-2026-11-07.md` (diagnóstico y hallazgos) + la sección «Contexto y decisiones» de este plan.

## Contexto y decisiones

### Por qué
El flujo de repuestos existe como «solicitud con cotizaciones» pero vive aislado: el ítem no apunta al vehículo (`equipment_id` referencia instrumentos de servicio, no `fuel_vehicles`), la OC tampoco, la OT no sabe que se compró algo y Control operacional mide el costo de mantención con `mant_work_orders.total_cost`, un número tipeado a mano. En `bodega_dev` (clon de prod del 2026-11-02) las 5 solicitudes de repuestos son de demostración y ningún rol de mantención puede crearlas. Diagnóstico completo en el informe citado arriba.

### Decisiones del usuario (2026-11-07)
1. **Origen:** la solicitud nace desde la OT (acción «Pedir repuestos» que precarga vehículo, faena y OT) **y** desde `/solicitudes` con selector de equipo de flota y OT opcional.
2. **Aprobación:** sigue sólo en `jefa_chome`/`administrador` (`repuestos:approve`).
3. **Cotizaciones:** umbral por monto configurable en Admin. Bajo el umbral basta proveedor sugerido y precio estimado; sobre el umbral, 3 cotizaciones o justificación. Urgencia crítica con equipo detenido o OT vinculada: vía rápida con justificación obligatoria.
4. **Costo manual de la OT:** pasa a ser sólo mano de obra / taller externo. Costo de mantención por equipo = ese costo + OC de repuestos y servicios vinculadas al vehículo.
5. **Roles que crean/envían:** `jefe_mantencion` (ve todas), `supervisor_mantencion` y `admin_contrato` (ven las propias). El mecánico no.
6. **Centro de costo:** fuera de este plan (seguimiento aparte: nunca se asigna en ninguna solicitud ni OC).
7. **Catálogo de repuestos:** fase 2, plan aparte. Aquí el repuesto sigue siendo texto libre con precio estimado.
8. **Cierre del ciclo:** la OT **no** lleva repuestos como parte de su documento. Lo usado lo declara el mecánico en el registro de la correctiva (app y PC), que ya existe. La OT muestra, como información, las solicitudes/OC vinculadas y, al lado, lo que los registros enlazados declararon usar. Sin cambios en la app del mecánico.

### Decisiones mías (revisables)
- El selector de vehículo aplica a **repuestos y servicios** (misma columna, mismo editor); los campos libres Equipo/Patente/Marca/Modelo quedan como respaldo «otro equipo» sólo cuando no se elige vehículo. El umbral de cotizaciones aplica **sólo a repuestos**; servicios conserva la regla actual.
- Umbral por defecto **$500.000**, clave `ops.repuestos.quotation_threshold_clp`, rango 0 a 50.000.000. Umbral 0 = nunca se exime.
- Monto a comparar: si hay cotizaciones, la **mayor** de las pendientes; si no, Σ cantidad × precio estimado (bloquea el envío si falta algún precio y no hay cotización).
- Costo de compras por vehículo se protege con `purchasing:view` (no existe permiso de costos de compras) y se cuenta por **fecha de emisión** de la OC dentro del período, OC no anulada ni eliminada, líneas no canceladas. «Costo total» del panel pasa a exigir las tres series (combustible, OT, compras); hoy `jefe_mantencion`, `jefa_chome`, `secretaria` y `administrador` ya tienen `purchasing:view`, así que nadie pierde la columna.
- No se registra un evento de OT al pedir repuestos. No se agregan tiles a Control operacional (A1: máximo 4); «esperando repuesto» va en el detalle del tile de OT. El filtro `?repuestos=pendientes` de la lista de OT no suma un control visible (A2: ya hay 6 primarios): se llega por chip, tile y enlace.
- Despacho por defecto para repuestos y servicios: `directo_faena`.
- Se elimina la tabla huérfana `quotations` (nivel OC), sin lecturas ni escrituras.
- Las OC atrasadas ya salen como «vencidas» en `/pendientes` (`operational-work-queue.ts` usa `estimated_delivery`); no se agrega cron.
- «Pedir repuestos» va en «Más acciones» de la OT (la cabecera ya recortó botones a propósito) y como CTA del estado vacío de la sección nueva.

### Correcciones a supuestos iniciales (lo que dice el código)
- El esquema vivo del ítem es `requestItemSchema` en `lib/validation/operations.ts:30-67`; `lib/validation/repuestos.ts` sólo aporta `quotationUploadSchema`, `selectQuotationSchema`. Los campos nuevos van en `operations.ts`.
- `persist-draft.ts:47,67` nunca ve `deliveryMode` ausente (`parse-request-form.ts:32` siempre manda uno): el default por tipo se fija en el cliente.
- La regla de 3 cotizaciones vive en **cuatro** copias: `submit-request.ts:45-49`, `request-form.helpers.ts:133-136`, `item-editor-cotizaciones.tsx:174-177`, `components/quotation-panel.tsx:144,160`.
- `quotationQueueFilter` (`lib/approvals-queue.ts:64`) y la rama `select_quotation` (`operational-work-queue.ts:681-699`) **no** exigen fila de cotización: una solicitud enviada sin cotización ya aparece en ambas colas.
- No se modifica el CHECK `purchase_request_items_one_service_subject` (Drizzle emitiría `DROP CONSTRAINT` sin `IF EXISTS` y el verificador lo rechaza); se agrega un CHECK nuevo.
- `purchase_order_items.quantity_received` ya trae lo recibido en faena; no hace falta `getOcReconciliation` en la OT.
- `receiving.ts` importa `notifyManyUser`/`notifyAfterCommit` desde `./notifications`; `receiving-two-stage.test.ts` mockea ese módulo.
- El fixture `fuel-veh-e2e` no tiene `code`: `vehicleLabel()` devuelve sólo `E2E-FUEL-1`.

## Global Constraints

- Migraciones sólo con `npm run db:generate` + `node scripts/verify-migration-chain.mjs --update-checksums`; nunca editar `_journal.json` ni un `.sql` ya publicado. Después, `npm run db:generate` debe reportar «No schema changes». Todo `DROP` nuevo con `IF EXISTS`.
- RBAC: defaults en `modules/*/manifest.ts`; para bases ya pobladas, entradas en `GRANT_ADDITIONS` (`lib/auth/bootstrap.ts:48`) y `npm run db:sync-rbac`. Nada de RBAC en migraciones.
- Toda suite PGlite nueva se registra en `tests/pglite-files.ts`; se corren de a una (`npm run test:pglite -- <nombre>`).
- Textos de UI en español; estados nunca como enum crudo (`itemStatusLabel` de `lib/work-queue-labels.ts:83`, `OT_STATE_META`).
- Fechas con `formatDate`/`formatDateTime`; hoy con `todayInChile()`.
- Cambios de filtro en URL con `router.replace(url, { scroll: false })`.
- `Field` de `@/components/ui/field` para todo input; `Combobox` de `@/components/ui/combobox` para el selector de vehículo; `EmptyState` para vacíos con CTA.
- Máximo 4 tiles de KPI fuera de `/dashboard` (A1); `e2e/control-operacional-navegacion.spec.ts:516-522` lo verifica.
- Colores de texto con tokens `-ink`.
- `bodega_dev` está atrasada en migraciones (no tiene `mant_work_orders.total_cost`): `npm run db:migrate` + `npm run db:sync-rbac` contra ella antes de verificar en navegador. Nunca imprimir credenciales.

## Review Focus

1. **Cambiar la faena del formulario con un vehículo ya elegido** → el vehículo y la OT deben limpiarse (o el servidor rechaza «El equipo pertenece a otra faena»). Test en T3: `it("cambiar la faena limpia vehículo y OT del ítem")`.
2. **OT cerrada con líneas sin recibir** → no cuenta como «esperando repuesto» (el equipo ya salió); la sección de la OT sí las lista. Test en T10: `it("una OT cerrada no se marca esperando repuesto aunque tenga líneas sin recibir")`.
3. **Solicitud cancelada después de vincularse** → sus ítems quedan `rejected` y desaparecen del predicado; la OT no la cuenta. Test en T10: `it("una solicitud cancelada no deja a la OT esperando repuesto")`.
4. **Umbral 0** → ninguna solicitud se exime (la regla legada aplica). Test en T7: `it("umbral 0 nunca exime")`.
5. **Recepción parcial de un ítem con OT** → no avisa a mantención hasta la recepción completa en faena; la OT muestra `recibido 1/3`. Test en T14: `it("una recepción parcial no avisa; la completa sí")`.

---

## Fase A — Modelo y formulario

### Task 1: Schema — vehículo, OT y precio estimado en el ítem

**Files:**
- Modify: `db/schema/requests.ts:69-135` (columnas), `:196-205` (relations)
- Modify: `lib/services/purchasing-module/purchase-orders-create.ts:219-238` (split parcial)
- Create: migración generada `db/migrations/0378_*.sql` + checksums
- Test: `lib/__tests__/repuestos-vehicle-link-pglite.test.ts` (nuevo; harness como `lib/__tests__/full-flow-integration.test.ts:18-28`; registrar), `db/schema-consistency.test.ts`

**Interfaces (produce):**
```ts
vehicleId:          text("vehicle_id").references(() => fuelVehicles.id)
workOrderId:        text("work_order_id").references(() => mantWorkOrders.id, { onDelete: "set null" })
estimatedUnitPrice: numeric("estimated_unit_price", { precision: 12, scale: 2, mode: "number" })
// índices: purchase_request_items_vehicle_idx, purchase_request_items_work_order_idx
// CHECK purchase_request_items_work_order_needs_vehicle: work_order_id IS NULL OR vehicle_id IS NOT NULL
// CHECK purchase_request_items_one_asset_subject: NOT (vehicle_id IS NOT NULL AND (equipment_id IS NOT NULL OR emergency_resource_id IS NOT NULL))
// relations: vehicle: one(fuelVehicles, …), workOrder: one(mantWorkOrders, …)
```

- [ ] Step 1: Tests PGlite: `it("rechaza work_order_id sin vehicle_id")`, `it("rechaza vehicle_id junto a equipment_id")`, `it("la compra parcial conserva vehículo, OT y precio estimado en el remanente")`.
- [ ] Step 2: `npm run test:pglite -- repuestos-vehicle-link` → FAIL (columnas inexistentes).
- [ ] Step 3: Agregar columnas, índices, checks y relations (si `tsc` acusa ciclo de módulos, declarar la relación `workOrder` desde `mantencion-work-orders.ts`). Copiar las tres columnas al ítem hermano en el split parcial.
- [ ] Step 4: `npm run db:generate` → el SQL sólo con `ADD COLUMN`, `ADD CONSTRAINT`, `CREATE INDEX` (forma de `0365_slow_sebastian_shaw.sql`); `node scripts/verify-migration-chain.mjs --update-checksums`; `npm run db:generate` otra vez → «No schema changes».
- [ ] Step 5: `npm run test:pglite -- repuestos-vehicle-link`, `npm run test:pglite -- schema-consistency`, `npm run db:verify-migrations` → PASS.
- [ ] Step 6: Commit `feat(solicitudes): vincula ítems de repuestos con vehículo y OT`.

### Task 2: Catálogo de vehículos para el formulario

**Files:**
- Create: `lib/services/request-vehicle-options.ts`
- Test: `lib/__tests__/request-vehicle-options-pglite.test.ts` (registrar)

**Interfaces (produce):**
```ts
export interface RequestVehicleOption {
  id: string; code: string | null; plate: string; label: string; hint: string
  worksiteId: string; brand: string | null; model: string | null; operationalStatus: string
  openWorkOrders: { id: string; folio: string; status: string }[]
}
export async function listVehicleOptionsForRequests(session: Session): Promise<RequestVehicleOption[]>
```
`label = vehicleLabel(v)` (`lib/services/fleet.ts:79`), `hint = "{typeName} · {worksiteName}"`, sólo `isActive`, alcance `worksiteScopeSql(session, fuelVehicles.worksiteId)`, OT con `status IN OT_OPEN_STATUSES` (`lib/mantencion/work-order-states.ts:30`), orden por `plate`.

- [ ] Step 1: Tests: `it("sólo lista vehículos activos del alcance de la sesión")`, `it("adjunta las OT abiertas y omite cerradas/anuladas")`.
- [ ] Step 2: FAIL → Step 3: implementar → Step 4: PASS.
- [ ] Step 5: Commit `feat(solicitudes): catálogo de vehículos de flota para solicitudes`.

### Task 3: Formulario — selector de equipo, OT y precio estimado

**Files:**
- Modify: `app/(app)/solicitudes/request-form.types.ts` (`VehicleOption = RequestVehicleOption`; `ItemRow` + `vehicleId`, `vehicleLabel`, `workOrderId`, `workOrderFolio`, `estimatedUnitPrice` (strings); `EditItem` y `PrefillItem` + los mismos con `estimatedUnitPrice: number | null`)
- Modify: `app/(app)/solicitudes/request-form.helpers.ts:36` (`blankItem`/`blankItemForType`)
- Modify: `app/(app)/solicitudes/item-editor-equipment.tsx` (props `vehicles: VehicleOption[]`, `worksiteId: string`, `onSelectVehicle(vehicleId: string)`, `onSelectWorkOrder(id: string)`)
- Modify: `app/(app)/solicitudes/item-editor.tsx:468-486` (pasar `vehicles`; mostrar `ItemEditorSupplier` también para `repuestos`), `request-form.tsx` (props `vehicles?: VehicleOption[]`, `initialUrgency?: string`), `use-request-form.ts:252-330,498-502` (hidratación desde `editRequest`/`prefill`, serialización; `onSelectVehicle` fija `vehicleId/vehicleLabel` y limpia `workOrderId`; cambiar `worksiteId` limpia vehículo y OT de todos los ítems)
- Modify: `lib/validation/operations.ts:30-67` (`vehicleId`, `workOrderId`: `z.string().max(60).nullable().optional()`; `estimatedUnitPrice: z.preprocess(v => v === "" || v == null ? null : v, z.coerce.number().nonnegative().max(999_999_999).nullable())`)
- Modify: `app/(app)/solicitudes/actions-module/draft.ts:60-73`, `lib/requests/request-config.ts:41-54` (`RequestItemInput` + `vehicleId?`, `workOrderId?`, `estimatedUnitPrice?`), `lib/requests/request-service-module/persist-draft.ts:89-117`
- Modify: `app/(app)/solicitudes/nueva/page.tsx` y `[id]/page.tsx` (cargar `listVehicleOptionsForRequests(session)` y pasar `vehicles`; `[id]` resuelve `vehicleLabel`/`workOrderFolio` por `inArray` como hace con `serviceEquipment` en :146-160, los mapea a `EditItem` en :428 y pasa también `equipment` al `RequestForm`, que hoy falta en :491-502)
- Test: `app/(app)/solicitudes/item-editor.test.tsx`, `lib/__tests__/parse-request-form.test.ts`, `lib/__tests__/repuestos-vehicle-link-pglite.test.ts`

**Comportamiento:** con tipo de cotización, `ItemEditorEquipment` abre con `Combobox` «Equipo de flota» (placeholder «Busca por código o patente», `clearLabel` «Otro equipo (no está en flota)», opciones filtradas por el `worksiteId` del formulario). Con vehículo: se ocultan Equipo/Patente/Marca/Modelo libres (el servidor no los persiste como atributos) y aparece `Select` «Orden de trabajo» con las `openWorkOrders` del vehículo (opción «Sin OT»). Sin vehículo: campos libres como hoy. Siempre: N° de Parte (repuestos), Observaciones, `Input type=number` «Precio unitario estimado (CLP)» con helper «Opcional. Bajo el umbral permite enviar sin cotización.», y `ItemEditorSupplier`.

**Persistencia:** por ítem con `vehicleId`: `fuel_vehicles` activo y de la faena de la solicitud, si no «El equipo seleccionado no existe o está inactivo» / «El equipo pertenece a otra faena». Con `workOrderId`: `mant_work_orders.vehicle_id` igual al vehículo («La OT no corresponde al equipo elegido») y `status IN OT_OPEN_STATUSES` («La OT ya está cerrada o anulada»). El loop de atributos salta `equipmentName/patent/brand/model` cuando hay `vehicleId`.

- [ ] Step 1: Tests de componente: `it("repuestos: muestra el combobox de flota y oculta patente libre al elegir un vehículo")`, `it("muestra las OT abiertas del vehículo elegido")`, `it("repuestos: muestra proveedor sugerido y precio estimado")`, `it("cambiar la faena limpia vehículo y OT del ítem")`.
- [ ] Step 2: Tests PGlite: `it("rechaza vehículo de otra faena")`, `it("rechaza OT de otro vehículo")`, `it("rechaza OT cerrada")`, `it("con vehículo no guarda atributos Equipo/Patente/Marca/Modelo")`, `it("guarda estimated_unit_price")`.
- [ ] Step 3: FAIL → Step 4: implementar → Step 5: PASS; `npm run typecheck`.
- [ ] Step 6: Commit `feat(solicitudes): selector de equipo de flota, OT y precio estimado en repuestos`.

### Task 4: Prellenado desde la OT y desde el vehículo

**Files:**
- Create: `app/(app)/solicitudes/nueva/prefill.ts` (extraer `buildPrefill` de `nueva/page.tsx` para testearla con `@/db` mockeado)
- Modify: `app/(app)/solicitudes/nueva/page.tsx:27-47` (`searchParams.ot`, `searchParams.vehiculo`), `request-form.tsx`/`use-request-form.ts` (`initialUrgency`)
- Test: `lib/__tests__/solicitudes-nueva-prefill-ot.test.ts`

**Contrato (lo consumen T11 y T16):** `GET /solicitudes/nueva?tipo=repuestos&ot=<workOrderId>` o `?tipo=repuestos&vehiculo=<vehicleId>`. Servidor: carga OT (`id, folio, vehicleId, worksiteId, status`) + vehículo; exige `canAccessWorksite(session, worksiteId)` y, con OT, `status IN OT_OPEN_STATUSES`; si falla → `prefillNotice: "La OT no existe, está cerrada o está fuera de tus faenas."` (o «El equipo no existe o está fuera de tus faenas.») y formulario vacío. Si pasa: `initialWorksiteId`, `initialUrgency = "high"` (sólo con OT), `prefillItems = [{ productId: null, productNameFree: "", quantity: 1, unitOfMeasure: "unidad", urgency, notes: "", vehicleId, vehicleLabel, workOrderId, workOrderFolio }]`, `prefillNotice: "Repuestos para la OT {folio} · {vehicleLabel}. Completa la descripción y la cantidad."`.

- [ ] Step 1: Tests: `it("precarga faena, vehículo y OT desde ?ot=")`, `it("precarga sólo el vehículo desde ?vehiculo=")`, `it("ignora una OT cerrada con aviso")`, `it("ignora una OT fuera del alcance")`.
- [ ] Step 2-4: FAIL → implementar → PASS.
- [ ] Step 5: Commit `feat(solicitudes): precarga de repuestos desde una OT o un vehículo`.

### Task 5: Permisos para mantención

**Files:**
- Modify: `modules/repuestos/manifest.ts:23-50` (`jefe_mantencion` → create/view_own/view_all/submit; `supervisor_mantencion`, `admin_contrato` → create/view_own/submit), `lib/auth/bootstrap.ts:48` (`GRANT_ADDITIONS` con `key: "2026-11-07-<roleId>-<permissionId>"`, roleIds de `lib/auth/system-rbac.ts:27-45`, permissionIds `p-rep-create|p-rep-own|p-rep-all|p-rep-submit`)
- Test: `lib/__tests__/bootstrap.test.ts` (PGlite), `lib/__tests__/auth-bootstrap-permissions.test.ts`, `lib/__tests__/request-type-permissions.test.ts`; `architecture-doc-rbac.test.ts` sólo si cambian conteos (no cambian permisos, sólo grants)

- [ ] Step 1: `it("concede repuestos:create a jefe_mantencion en una BD ya poblada")` en `bootstrap.test.ts`.
- [ ] Step 2-4: FAIL → manifest + `GRANT_ADDITIONS` → `npm run test:fast -- auth-bootstrap request-type-permissions`, `npm run test:pglite -- bootstrap` PASS. `npm run db:sync-rbac` en `bodega_dev`.
- [ ] Step 5: Commit `feat(rbac): mantención puede solicitar repuestos`.

### Task 6: Despacho directo a faena por defecto

**Files:**
- Modify: `app/(app)/solicitudes/use-request-form.ts:252` (`useState(editRequest?.deliveryMode ?? (QUOTATION_TYPES.has(initialType) ? "directo_faena" : "via_oficina"))`; al cambiar `requestType` a un tipo de cotización sin edición manual previa, `setDeliveryMode("directo_faena")`), `lib/requests/request-service-module/persist-draft.ts:47,67` (fallback `?? "directo_faena"`)
- Test: `app/(app)/solicitudes/request-form.test.tsx`: `it("repuestos nace con despacho directo a faena")`.

- [ ] Steps: FAIL → implementar → PASS → Commit `fix(solicitudes): repuestos y servicios nacen directo a faena`.

## Fase B — Cotizaciones y aprobación

### Task 7: Umbral configurable y regla única de cotizaciones

**Files:**
- Create: `lib/requests/quotation-requirement.ts`, `lib/requests/quotation-requirement.test.ts`
- Modify: `lib/services/system-settings.ts:27-70` (`repuestosQuotationThresholdClp: "ops.repuestos.quotation_threshold_clp"`, default `500_000`, rango `{ min: 0, max: 50_000_000 }`), `app/(app)/admin/parametros-operativos/actions.ts:66-72` (`readNumber(formData, "repuestosQuotationThresholdClp")`), `ops-settings-form.tsx` (sección «Repuestos», `Field` «Monto bajo el cual no se exigen cotizaciones (CLP)», helper «Predeterminado: $500.000. Bajo este monto una solicitud de repuestos puede enviarse con una cotización o sólo con precios estimados. 0 = siempre se exigen.»)
- Modify: `lib/requests/request-service-module/submit-request.ts:45-49`, `app/(app)/solicitudes/request-form.helpers.ts:133-136`, `item-editor-cotizaciones.tsx:174-177`, `components/quotation-panel.tsx:144,160`, `app/(app)/solicitudes/request-form.tsx` (prop `quotationThresholdClp: number | null`), `nueva/page.tsx` y `[id]/page.tsx` (leen `getOperationalSettings()` y pasan el umbral; `[id]` pasa a `QuotationPanel` el `estimatedTotal`)
- Test: `lib/__tests__/admin-ops-settings-actions.test.ts`, `lib/__tests__/repuestos-vehicle-link-pglite.test.ts` (submit), `app/(app)/solicitudes/request-form.helpers.test.ts`

**Interfaces (produce):**
```ts
export type QuotationRequirementReason = "no_quotation_or_estimate" | "needs_quotation" | "needs_three" | "needs_justification"
export interface QuotationRequirementInput {
  quotationTotals: number[]; estimatedTotal: number | null
  /** null = sin umbral (servicios): regla legada. */
  thresholdClp: number | null
  urgency: string; fastPathEligible: boolean; hasJustification: boolean
}
export function estimatedRequestTotal(items: { quantity: number; estimatedUnitPrice: number | null }[]): number | null // null si algún ítem no tiene precio
export function evaluateQuotationRequirement(i: QuotationRequirementInput): { ok: true } | { ok: false; reason: QuotationRequirementReason }
export function quotationRequirementMessage(reason: QuotationRequirementReason, thresholdClp: number | null): string
```
Algoritmo: `if (totals.length === 0 && estimated === null) → no_quotation_or_estimate`; `amount = totals.length ? max(totals) : estimated`; `if (threshold !== null && threshold > 0 && amount <= threshold) → ok`; `if (totals.length >= 3) → ok`; `fast = urgency === "critical" && fastPathEligible`; `if (totals.length === 0 && !fast) → needs_quotation`; `if (!hasJustification) → fast ? needs_justification : needs_three`; `ok`.
Mensajes: `no_quotation_or_estimate` «Adjunta al menos una cotización o indica el precio unitario estimado de todos los ítems.»; `needs_quotation` «Sobre {formatCLP(threshold)} se necesita al menos una cotización adjunta.» (sin umbral: «Adjunta al menos una cotización antes de enviar la solicitud.»); `needs_three` «Sobre {formatCLP(threshold)} se requieren 3 cotizaciones. Si no es posible, agrega una justificación en Notas generales.» (sin umbral: texto actual de `submit-request.ts:50`); `needs_justification` «Urgencia crítica con equipo detenido: puedes enviar con menos de 3 cotizaciones, pero debes justificarlo en Notas generales.»

**Servidor (`submitRequest`):** `thresholdClp = config.requestType === "repuestos" ? (await getOperationalSettings(tx)).repuestosQuotationThresholdClp : null`; `fastPathEligible = items.some(i => i.workOrderId) || vehículos de los ítems con operational_status !== "operativo"`; `hasJustification = !!request.notes?.trim()`; lanzar `new Error(quotationRequirementMessage(reason, thresholdClp))`. **Cliente:** mismo cálculo con `vehicles`; los subtítulos de `quotation-panel.tsx:144,160` describen el estado («Bajo el umbral: puede aprobarse sin cotización» / mensaje de la regla).

- [ ] Step 1: Unit tests: `bajo umbral sin cotizaciones pero con estimados → ok`, `sin cotizaciones ni estimados → no_quotation_or_estimate`, `sobre umbral con 1 cotización y notas → ok`, `sobre umbral sólo estimados sin vía rápida → needs_quotation`, `vía rápida sin notas → needs_justification`, `servicios (threshold null) con 2 cotizaciones y sin notas → needs_three`, `umbral 0 nunca exime`.
- [ ] Step 2: `it("guarda repuestosQuotationThresholdClp")`; PGlite: `it("submit bajo umbral sin cotización pasa")`, `it("submit sobre umbral sin cotización falla con el monto en el mensaje")`.
- [ ] Step 3-5: FAIL → implementar (las cuatro copias cliente llaman a la misma función) → PASS.
- [ ] Step 6: Commit `feat(repuestos): umbral configurable para exigir cotizaciones`.

### Task 8: Aprobar sin cotización

**Files:**
- Create: `lib/requests/request-service-module/approve-without-quotation.ts`
- Modify: `lib/requests/request-service-module/{factory,index}.ts`, `lib/requests/request-config.ts` (`ApproveWithoutQuotationInput`, `RequestServiceFunctions.approveWithoutQuotation?`), `lib/services/repuestos.ts` (`approveRepuestoWithoutQuotation`), `lib/requests/request-actions-workflow.ts` (`approveWithoutQuotationActionImpl`), `request-actions.ts`, `request-actions.types.ts` (`schemas.approveWithoutQuotation`), `lib/validation/repuestos.ts` (`approveWithoutQuotationSchema = z.object({ requestId, justification })`), `app/(app)/repuestos/actions.ts`, `app/(app)/repuestos/quotation-panel.tsx`, `components/quotation-panel.tsx` (prop opcional `approveWithoutQuotationAction?`; botón «Aprobar sin cotización» + `ConfirmDialog` con `Textarea` de justificación opcional cuando `quotations.length === 0 && canApprove && isPendingReview`), `lib/services/operational-work-queue.ts:681-699` (`cta_label` «Aprobar solicitud», `status_label` «Esperando aprobación» cuando no hay cotizaciones)
- Test: `lib/__tests__/repuestos-vehicle-link-pglite.test.ts`, `lib/__tests__/request-actions.test.ts`, `app/(app)/repuestos/actions.test.ts`

**Interfaces:**
```ts
export interface ApproveWithoutQuotationInput { requestId: string; userId: string; userEmail?: string; roleContext?: string; justification?: string | null; worksiteIds?: string[] | "all" }
export async function approveWithoutQuotation(config: Pick<RequestModuleConfig, "requestType" | "quotationsTable">, input: ApproveWithoutQuotationInput): Promise<void>
```
Espejo de `select-quotation.ts`: lock `FOR UPDATE`, status ∈ `submitted|in_review`, scope; **si existe alguna cotización `pending` → `throw new Error("Hay cotizaciones adjuntas: selecciona la ganadora")`**; aprueba ítems `requested` conservando `suggestedSupplierId/supplierHint`, sin tocar `awardedQuotation*`; `approvalDecisions.reason = "Aprobada sin cotización (bajo umbral o vía rápida)"` + («. Fundamento: …»); request → `approved`; `recordStatusChange`/`recordAudit` igual que el espejo. La acción exige `permissions.approve`, notifica al solicitante (`request_approved`) y revalida las mismas rutas que `selectQuotationActionImpl`.

- [ ] Step 1: PGlite: `it("aprueba todos los ítems requested sin cotización")`, `it("rechaza si hay cotizaciones pendientes")`, `it("rechaza fuera del alcance de faena")`. Acción: `it("exige repuestos:approve")`.
- [ ] Step 2-4: FAIL → implementar → PASS.
- [ ] Step 5: Commit `feat(repuestos): aprobación sin cotización bajo umbral`.

### Task 9: Compras — precio estimado y equipo en la OC

**Files:**
- Modify: `app/(app)/compras/oc-form.types.ts:26-57` (`PendingItemOption` + `estimatedUnitPrice?: number | null`, `vehicleLabel?: string | null`, `workOrderFolio?: string | null`), `compras/nueva/page.tsx:46-71,178-213` (select + 3 columnas; `leftJoin(fuelVehicles)`, `leftJoin(mantWorkOrders)`), `oc-form.helpers.ts` (`suggestedPrice`: adjudicada → `estimatedUnitPrice` → catálogo; `priceHint`: «Precio estimado por el solicitante: {formatCLP}»), `oc-form-items.tsx` (`vehicleLabel · OT folio` bajo el nombre)
- Modify: `lib/services/purchasing-module/pending-purchase-queue.ts:38,187-218,257-271` (`PendingPurchaseItem.vehicleLabel: string | null`), `app/(app)/compras/pending-purchase-list.tsx`
- Modify: `app/(app)/compras/[id]/page.tsx:129-133` (`with: { …, vehicle: true, workOrder: { columns: { folio: true } } }`), `:656` (`vehicleLabel`, `workOrderFolio`), `oc-detail.types.ts` (`OcDetailItem` + 2), `oc-detail-items.tsx:16-26` (`ItemContext`: `Equipo: {vehicleLabel}{workOrderFolio ? " · OT " + folio : ""}`)
- Test: `app/(app)/compras/oc-form.helpers.test.ts`, `lib/__tests__/pending-purchase-queue.test.ts`, `app/(app)/compras/[id]/oc-detail-items.test.tsx`

- [ ] Step 1: Tests: `it("prefija el precio estimado cuando no hay adjudicación")`, `it("la adjudicación de una línea gana sobre el estimado")`, `it("la cola de compras trae la etiqueta del vehículo")`, `it("ItemContext muestra equipo y OT")`.
- [ ] Step 2-4: FAIL → implementar → PASS.
- [ ] Step 5: Commit `feat(compras): precio estimado y equipo/OT en OC de repuestos`.

## Fase C — OT y mantención

### Task 10: Predicado compartido y lector «Repuestos pedidos»

**Files:**
- Create: `lib/services/mantencion/work-orders/parts-requests.ts`
- Modify: `lib/services/mantencion/work-orders/types.ts:85-129` (`WorkOrderDetail`), `query.ts:280-295` (`Promise.all` de `loadWorkOrderDetail`)
- Test: `lib/__tests__/mantencion-work-orders-parts-pglite.test.ts` (registrar; fixtures `seedMantFixtures`/`IDS` de `lib/__tests__/mantencion-sync-fixtures.ts`)

**Interfaces (produce):**
```ts
// types.ts
export interface WorkOrderPartsRequest {
  requestId: string; requestCode: string; requestStatus: string
  itemId: string; description: string; quantity: number; unitOfMeasure: string
  itemStatus: string; itemStatusLabel: string
  orderId: string | null; orderCode: string | null; orderStatus: string | null
  estimatedDelivery: string | null; quantityReceived: number; requestedAt: string
}
export interface WorkOrderPartUsed { recordId: string; recordFolio: string | null; quantity: number; description: string }
// en WorkOrderDetail:
partsRequests: WorkOrderPartsRequest[]
/** Lo que los registros enlazados declararon usar (mant_record_parts), vía loadWorkOrderLinkedWork. */
partsUsed: WorkOrderPartUsed[]
/** OT abierta con alguna línea pedida que todavía no llegó a faena. */
waitingParts: boolean

// parts-requests.ts
export const PARTS_PENDING_ITEM_STATUSES = ["draft","requested","approved","pending_purchase","in_purchase_order","purchased","partially_office_received","office_received","partially_received"] as const
/** EXISTS sobre purchase_request_items (work_order_id = <col>, estado pendiente, solicitud no cancelada/rechazada). Única fuente para lista, panel y tile. */
export function partsPendingExistsSql(workOrderId: AnyPgColumn | SQL): SQL
export async function loadWorkOrderPartsRequests(workOrderId: string): Promise<WorkOrderPartsRequest[]>
export function isWaitingParts(status: OtStatus, rows: readonly Pick<WorkOrderPartsRequest, "itemStatus" | "requestStatus">[]): boolean // false si la OT no está en OT_OPEN_STATUSES
```
Join: `purchaseRequestItems` (`eq(workOrderId)`) → `purchaseRequests` → leftJoin `purchaseOrderItems` (`requestItemId`, `status <> 'cancelled'`) → leftJoin `purchaseOrders` (`status <> 'cancelled'`, `deletedAt IS NULL`); `quantityReceived` = `purchaseOrderItems.quantityReceived`; orden `requestedAt desc, sortOrder`. **Sin alcance de permisos de solicitudes**: lo llama `loadWorkOrderDetail` después de `canSeeWorkOrder`; ver la OT incluye ver lo pedido para ella (misma regla que `linked-work.ts:8-13`), comentado en el archivo. `partsUsed` sale de `loadWorkOrderLinkedWork(id)` (ya existe) aplanando `parts`.

- [ ] Step 1: Tests: `it("lista las líneas pedidas para la OT con su OC activa, entrega estimada y cantidad recibida en faena")`, `it("ignora las líneas de OC anuladas y las OC eliminadas (deleted_at)")`, `it("isWaitingParts: recibido/entregado/rechazado no cuentan; in_purchase_order sí")`, `it("una OT cerrada no se marca esperando repuesto aunque tenga líneas sin recibir")`, `it("una solicitud cancelada no deja a la OT esperando repuesto")`, `it("partsPendingExistsSql coincide con isWaitingParts sobre las mismas filas")`, `it("partsUsed aplana los repuestos de los registros enlazados")`.
- [ ] Step 2: `npm run test:pglite -- mantencion-work-orders-parts` → FAIL.
- [ ] Step 3: Implementar; en `loadWorkOrderDetail` sumar al `Promise.all` y devolver `partsRequests`, `partsUsed`, `waitingParts`.
- [ ] Step 4: PASS; `npm run typecheck`.
- [ ] Step 5: Commit `feat(mantencion): lector de repuestos pedidos y usados por OT`.

### Task 11: Sección «Repuestos pedidos» y acción «Pedir repuestos» en la OT

**Files:**
- Modify: `components/mantencion/jefatura/ot/ot-sections.tsx` (nueva `OtPartsRequestsSection`), `ot-actions.tsx:25-63,196-222`, `app/(app)/mantencion/ot/[id]/page.tsx:37-96`, `ot-fixtures.ts:14`
- Test: `components/mantencion/jefatura/ot/ot-render.test.tsx`, `ot-actions.test.tsx`

**Interfaces:**
- `OtActionsProps.partsRequestHref: string | null` (la página lo calcula: `can(session, "repuestos:create") && !["cerrada", "anulada"].includes(detail.status) ? \`/solicitudes/nueva?tipo=repuestos&ot=${detail.id}\` : null`).
- `OtPartsRequestsSection({ detail, canOpenRequests, partsRequestHref }: { detail: WorkOrderDetail; canOpenRequests: boolean; partsRequestHref: string | null })`; `canOpenRequests = can(session, "repuestos:view_all")` (con `view_own` el enlace daría 404 sobre una ajena: texto plano).

- [ ] Step 1: Tests `ot-render.test.tsx`: `it("«Repuestos pedidos» lista solicitud, repuesto, estado en español, OC y entrega estimada; marca «Vencida» si la fecha pasó y falta recibir")`, `it("muestra «Declarados en los registros» con folio, cantidad y descripción")`, `it("sin solicitudes y con permiso, el estado vacío ofrece «Pedir repuestos» con la URL de prellenado")`, `it("sin permiso de solicitudes el código es texto, no enlace")`. `ot-actions.test.tsx`: `it("«Pedir repuestos» sólo aparece en el menú con partsRequestHref")`.
- [ ] Step 2: `npm run test:fast -- ot-render ot-actions` → FAIL.
- [ ] Step 3: `SectionCard title="Repuestos pedidos" description="Solicitudes de compra vinculadas a esta orden y su avance."` con `action` = `Button secondary asChild <Link href>` «Pedir repuestos» cuando `partsRequestHref`. Tabla: Solicitud · Repuesto · Cant. · Estado (`itemStatusLabel`) · OC · Entrega estimada (reutilizar `EstimateCell` con `estimateOverdue: fecha < hoy && quantityReceived < quantity`) · Recibido (`{quantityReceived}/{quantity}`). Debajo, lista «Declarados en los registros» (`partsUsed`), o «Ningún registro enlazado declara repuestos.». Vacío con permiso: `EmptyState` «Sin repuestos pedidos» + CTA; sin permiso: `Pending` «Nadie ha pedido repuestos para esta orden.». Menú «Más acciones»: `DropdownMenuItem asChild><Link href={partsRequestHref}>Pedir repuestos</Link>` antes de «Descargar PDF».
- [ ] Step 4: `page.tsx`: sección tras `OtItemsSection kind="mantencion"`; pasar `partsRequestHref` a `OtActions`. Fixture `otDetail()`: `partsRequests: []`, `partsUsed: []`, `waitingParts: false`.
- [ ] Step 5: PASS; `typecheck`; `lint`.
- [ ] Step 6: Commit `feat(mantencion): sección Repuestos pedidos y acción Pedir repuestos en la OT`.

### Task 12: «Esperando repuesto» en la lista de OT y en el panel

**Files:**
- Modify: `types.ts:35-60` (`WorkOrderListRow.waitingParts: boolean`), `query.ts:33-44` (`WorkOrderListFilters.partsPending?: boolean`), `query.ts:63-79` (`baseWhere`), `query.ts:101-150` (`listColumns` + `toListRow`), `components/mantencion/jefatura/ot/ot-filters.ts` (`OT_FILTER_PARAMS` + `"repuestos"`, `parseWorkOrderQuery`, `hasWorkOrderFilters`, `workOrderFilterCount`), `ot-list-filters.tsx:43-50` (chip «Repuestos: pendientes»), `ot-table.tsx:31-41` (`StatusCell`), `lib/services/mantencion/panel.ts:45-62,288-295` (`PanelWorkshopRow.waitingParts: boolean`), `components/mantencion/jefatura/panel/panel-cards.tsx:250-280` (`WorkshopCard`), `app/(app)/mantencion/ot/page.tsx:72` (`exportFilters`)
- Test: `lib/__tests__/mantencion-work-orders-parts-pglite.test.ts` (ampliar), `ot-render.test.tsx`, `lib/__tests__/mantencion-panel-pglite.test.ts`, `components/mantencion/jefatura/panel/panel-render.test.tsx`

**Interfaces:** `listColumns.waitingParts: sql<boolean>\`${isOpen} AND ${partsPendingExistsSql(mantWorkOrders.id)}\``; `baseWhere` agrega `filters.partsPending ? and(isOpen, partsPendingExistsSql(mantWorkOrders.id)) : undefined`; `parseWorkOrderQuery`: `partsPending: first(raw, "repuestos") === "pendientes"`.

- [ ] Step 1: Tests: pglite `it("listWorkOrders marca waitingParts y ?repuestos=pendientes deja sólo esas")`; `ot-render.test.tsx` `it("lee repuestos=pendientes como filtro y lo limpia con «Limpiar filtros»")`, `it("una OT esperando repuesto lo dice en la celda de estado")`; panel pglite `it("una OT en taller con una línea sin recibir sale con waitingParts")`; `panel-render.test.tsx` `it("«En taller ahora» escribe «Esperando repuesto»")`.
- [ ] Step 2: FAIL.
- [ ] Step 3: Implementar. Chip: `add("repuestos", "Repuestos", partsPending ? "pendientes" : "", "Esperando repuesto")`. `StatusCell` y `WorkshopCard`: `<span className="text-xs font-medium text-[var(--color-signal-ink)]">Esperando repuesto</span>`. Fixture `otRow()`: `waitingParts: false`. `partsPending` en `exportFilters` (el Excel comparte `workOrdersWhere`).
- [ ] Step 4: PASS; `typecheck`.
- [ ] Step 5: Commit `feat(mantencion): OT esperando repuesto en lista, filtro y panel`.

### Task 13: Cifra global y tile de atención

**Files:**
- Modify: `lib/services/mantencion/work-orders/metrics.ts:71-75,177-194` (`WorkOrderGlobalMetrics.waitingParts: number`), `app/(app)/control-operacional/attention-tiles.ts:74-94`
- Test: `lib/__tests__/mantencion-work-orders-metrics-pglite.test.ts`, `app/(app)/control-operacional/attention-tiles.test.ts`, `lib/__tests__/operational-control-hub-attention.test.ts` (fixture mockeada: sumar el campo)

- [ ] Step 1: Tests: `it("waitingParts cuenta sólo OT abiertas con alguna línea de repuesto sin recibir")`; tiles `it("agrega «N esperando repuesto» al detalle y pone tono de señal")` (`detail` contiene «2 esperando repuesto», `tone === "signal"`), `it("sin esperas no nombra el cero")`.
- [ ] Step 2: FAIL.
- [ ] Step 3: `waitingParts: sql<number>\`(COUNT(*) FILTER (WHERE ${isOpen} AND ${partsPendingExistsSql(mantWorkOrders.id)}))::int\``. En `workOrdersTile`, `parts` gana `...(workOrders.waitingParts > 0 ? [\`${count(workOrders.waitingParts)} esperando repuesto\`] : [])` y el tono lo considera; `href` → `${ATTENTION_HREFS.workOrders}&repuestos=pendientes` sólo cuando hay esperas (sin tile nuevo: A1 se mantiene).
- [ ] Step 4: PASS. Commit `feat(control-operacional): OT esperando repuesto en el tile de órdenes`.

### Task 14: Aviso a mantención cuando el repuesto llega a faena

**Files:**
- Modify: `db/schema/audit.ts:144-149` (`| "mant_ot_parts_received"`), `lib/services/mantencion/work-orders/notifications.ts`, `lib/services/receiving.ts:130-136,362-375,468-470`
- Test: `lib/__tests__/receiving-parts-notification-pglite.test.ts` (registrar), `lib/__tests__/mantencion-work-orders-notifications.test.ts` (unitario, `@/db` mockeado)

**Interfaces:**
```ts
export async function notifyWorkOrderPartsReceived(input: { workOrderId: string; receiptId: string; actorUserId: string; itemCount: number }): Promise<void>
```
Destinatarios: asignado + `forPermission(OT_PERMISSIONS.manage)` (mismo `holdersBeyondAdmin`), sin el actor. Tipo `mant_ot_parts_received`, título «Repuestos recibidos para OT {folio}», cuerpo «{equipo} · {n} línea(s) recibida(s) en faena. Revisa «Repuestos pedidos» en la OT.», href `/mantencion/ot/{id}`, dedupe `mant-ot-parts:{workOrderId}:{receiptId}`. Si la OT está `cerrada`/`anulada`, no avisa.

- [ ] Step 1: Tests: notifications `it("avisa al mecánico asignado y a quien administra, nunca al actor, con dedupe por recepción")`, `it("no avisa si la OT está cerrada o anulada")`; receiving (pglite, mock de `@/lib/services/mantencion/work-orders/notifications`) `it("una recepción completa en faena de un ítem con work_order_id dispara notifyWorkOrderPartsReceived después del commit, una vez por OT")`, `it("una recepción parcial no avisa; la completa sí")`, `it("la recepción en oficina no avisa a mantención")`.
- [ ] Step 2: FAIL.
- [ ] Step 3: En `receiving.ts`, el `findFirst` de `reqItem` (~:371) incluye `columns: { id: true, workOrderId: true }`; acumular `partsArrivals: Map<string, number>` sólo con `fullReceived && stage === "faena"`; tras la transacción, `for (const [workOrderId, itemCount] of partsArrivals) notifyAfterCommit(() => notifyWorkOrderPartsReceived({ workOrderId, receiptId, actorUserId: input.receivedBy, itemCount }))`.
- [ ] Step 4: PASS. Commit `feat(recepcion): aviso a mantención al recibir repuestos de una OT`.

## Fase D — Costos y fichas

### Task 15: Costo por equipo con compras vinculadas

**Files:**
- Create: `lib/services/purchasing-module/vehicle-purchase-summary.ts`
- Modify: `lib/operational-control/capabilities.ts:43-51`, `lib/services/operational-control.ts` (`OperationalAsset`, `Promise.all`, `vehicleAssets`, `serviceAssets`, `permissions`), `app/(app)/control-operacional/page.tsx:140-144,309-317`, `operational-assets-table.tsx:35-90,204-221,420-436`, `performance-stats.ts:195-200,239-245` (+ firma de `buildPerformanceGlossary`), `lib/operational-control/export-columns.ts:15,98`, `app/(app)/control-operacional/actions.ts:30-32,38-79,93`, `components/mantencion/jefatura/ot/new-ot-sheet.tsx:244-247`, `ot-aside.tsx:129-133`
- Test: `lib/__tests__/operational-control-purchases-pglite.test.ts` (registrar), `operational-control-capabilities.test.ts`, `operational-control-export-columns.test.ts`, `operational-control-export-action.test.ts`, `app/(app)/control-operacional/performance-stats.test.ts`, `components/mantencion/jefatura/ot/new-ot-sheet.test.tsx`

**Interfaces:**
```ts
export interface VehiclePurchaseSummary { vehicleId: string; purchaseAmount: number; orderCount: number; lastOrderAt: string | null }
export async function getVehiclePurchaseSummary(session: Session, period: { from: string; to: string }, vehicleIds: readonly string[]): Promise<Map<string, VehiclePurchaseSummary>>
// capabilities.ts
canViewPurchaseCosts: can(session, "purchasing:view")
// OperationalAsset
/** Σ líneas de OC (no anuladas) emitidas en el período, de solicitudes vinculadas al vehículo; null sin purchasing:view o si la consulta falló. */
purchaseAmount: number | null
/** Σ total_cost de OT cerradas en el período: mano de obra / taller externo. */
maintenanceCost: number | null
/** Combustible + mano de obra + compras; null si falta cualquiera de las tres. */
totalCost: number | null
```
Modelo `asset-fuel-summary.ts:69-80` (dedupe, mapa prellenado, `inArray`, `worksiteScopeSql(session, purchaseOrders.worksiteId)`). Consulta: `purchaseOrderItems` ⨝ `purchaseOrders` (`status <> 'cancelled'`, `deletedAt IS NULL`, `left(issuedAt, 10) BETWEEN from AND to`) ⨝ `purchaseRequestItems` (`vehicleId IN ids`); `SUM(subtotal) FILTER (WHERE purchaseOrderItems.status <> 'cancelled')`, `COUNT(DISTINCT purchaseOrders.id)`, `MAX(issuedAt)`. Sin `purchasing:view` devuelve el mapa vacío sin consultar.

- [ ] Step 1: Tests: pglite `it("suma las líneas de OC emitidas en el período por vehículo y excluye anuladas, eliminadas y de otro mes")`, `it("sin purchasing:view no consulta y deja el mapa vacío")`, `it("respeta el alcance de faena de la OC")`; capabilities `it("los costos de compras los abre purchasing:view, no combustibles:view_costs")`; export-columns `it("«Repuestos y servicios (OC)» sólo con purchasing:view; «Costo total» exige las tres")`; performance-stats `it("define mano de obra, compras vinculadas y el costo total sólo con sus capacidades")`; new-ot-sheet `it("el campo de costo dice mano de obra / taller externo")`.
- [ ] Step 2: FAIL.
- [ ] Step 3: Servicio; en el hub `const purchaseSummary = canViewPurchaseCosts && vehicles.length > 0 ? await settleAttention("compras", () => getVehiclePurchaseSummary(session, period, ids), degradedSources) : new Map()`, `purchaseUnavailable` como `fuelUnavailable`; `purchaseAmount = canViewPurchaseCosts ? (purchaseUnavailable ? null : summary?.purchaseAmount ?? 0) : null`; `totalCost` sólo con las tres no nulas; `permissions.canViewPurchaseCosts`; `page.tsx` `degradedTotal += canViewPurchaseCosts ? 1 : 0`.
- [ ] Step 4: UI/exportación: `COLUMNS` y `buildOperationalAssetExportColumns/Row` ganan un 7.º flag `canViewPurchaseCosts = false` (misma convención posicional). Columna `maintenanceCost` → «Mano de obra / taller (OT)»; nueva `purchaseAmount` «Repuestos y servicios (OC)» tras ella; `totalCost` con `canViewWorkOrders && showFuelCost && canViewPurchaseCosts`. `actions.ts`: `numFmt "$#,##0"` para `purchaseAmount`, fila de indicadores «Compras vinculadas a equipos», auditoría `includesPurchaseCosts`. Glosario: `ot-maintenance-cost` → «Mano de obra / taller externo (OT)»: «Suma del costo cargado a mano en las OT cerradas del período: mano de obra o taller externo. Los repuestos y servicios comprados por OC van en su propia cifra.»; nuevo `vehicle-purchases`: «Líneas de OC emitidas en el período de solicitudes de repuestos o servicios vinculadas al equipo, sin IVA, excluyendo OC anuladas.»; `ot-total-cost`: «Combustible del proveedor, mano de obra de OT cerradas y compras vinculadas. Sólo cuando las tres series están disponibles.». Copia de OT: label «Costo mano de obra / taller externo (CLP, opcional)», helper «Sólo mano de obra o taller externo. Los repuestos y servicios comprados por OC se suman solos desde la solicitud vinculada.»; `ot-aside` título «Mano de obra / taller externo», bajada «Cargado por jefatura. Los repuestos y servicios comprados por OC están en «Repuestos pedidos».».
- [ ] Step 5: PASS; `typecheck`; `lint`.
- [ ] Step 6: Commit `feat(control-operacional): compras vinculadas al vehículo en costo por equipo`.

### Task 16: Compras en la ficha del equipo (mantención) y del vehículo (flota)

**Files:**
- Create: `lib/services/vehicle-purchase-history.ts`, `components/fleet/vehicle-purchases-card.tsx` (sin `server-only`)
- Modify: `app/(app)/mantencion/equipos/[id]/page.tsx:47-57,60-90`, `components/mantencion/jefatura/equipos/equipment-detail-types.ts:8-40`, `equipment-detail-view.tsx:95-99`, `lib/services/fleet.ts:542-560,648-651`, `app/(app)/flota/[id]/page.tsx:220-222`
- Test: `lib/__tests__/vehicle-purchase-history-pglite.test.ts` (registrar), `components/fleet/vehicle-purchases-card.test.tsx`

**Interfaces:**
```ts
export interface VehiclePurchaseRecord {
  requestItemId: string; requestId: string; requestCode: string; requestType: string
  itemName: string; quantity: number; unitOfMeasure: string; itemStatus: string; itemStatusLabel: string
  workOrderId: string | null; workOrderFolio: string | null
  requestedAt: string; requesterName: string | null
  orderId: string | null; orderCode: string | null; orderStatus: string | null
  unitPrice: number | null; subtotal: number | null
}
export async function getVehiclePurchaseHistory(vehicleId: string, limit = 50): Promise<VehiclePurchaseRecord[]>
export function VehiclePurchasesCard({ records, canOpenRequests, newRequestHref }: { records: VehiclePurchaseRecord[]; canOpenRequests: boolean; newRequestHref: string | null })
// EquipmentDetailData.purchases: VehiclePurchaseRecord[] | null   (null = sin capacidad, no se dibuja)
// getFleetVehicleDetail(...).recentPurchases: VehiclePurchaseRecord[] | null
```
Modelo `service-equipment-history.ts:40-95` (+ `isNull(deletedAt)`, leftJoin `mantWorkOrders` para el folio). Gate en equipos: `purchasing:view || repuestos:view_all`; en flota: `purchasing:view`. `newRequestHref = can(session, "repuestos:create") ? \`/solicitudes/nueva?tipo=repuestos&vehiculo=${vehicleId}\` : null` (contrato de T4).

- [ ] Step 1: Tests: pglite `it("lista las compras del vehículo con OC, folio de OT y precio, más reciente primero")`, `it("una OC anulada o eliminada deja la línea sin OC")`; card `it("sin compras y con permiso ofrece pedir repuestos; sin permiso lo dice en texto")`, `it("muestra código de solicitud, OC, estado en español y subtotal")`.
- [ ] Step 2: FAIL. Step 3: implementar; en equipos, columna lateral tras `EquipmentHistoryList`; en flota, `Card` tras «Órdenes de trabajo…» titulada «Repuestos y servicios comprados». Step 4: PASS.
- [ ] Step 5: Commit `feat(flota,mantencion): compras vinculadas en la ficha del vehículo`.

## Fase E — Limpieza, E2E y verificación

### Task 17: Retirar la tabla huérfana `quotations`

**Files:** `db/schema/purchasing.ts:143-162` y `:362` (`quotations: many(quotations)`), migración generada, checksums.
- [ ] `grep -rn "quotations" --include=*.ts lib app db | grep -v "repuestoQuotations\|serviceQuotations\|const quotations"` vacío → borrar tabla y relación → `npm run db:generate` → en el `.sql` recién generado (aún no publicado) cambiar `DROP TABLE "quotations"` por `DROP TABLE IF EXISTS "quotations"` → `node scripts/verify-migration-chain.mjs --update-checksums` → `npm run test:pglite -- schema-consistency` y `npm run db:verify-migrations` PASS → Commit `chore(db): retira la tabla quotations sin uso`.

### Task 18: E2E — solicitudes y compras

**Files:** `e2e/repuestos-servicios-oc-flow.spec.ts`, `e2e/helpers.ts` (`pickVehicle(page, "E2E-FUEL-1")` sobre el `Combobox`), `e2e/setup-db.ts` (`ops.repuestos.quotation_threshold_clp = 500000` en `system_settings`; opcional `code: "E2E-01"` en `fuel-veh-e2e`)
- [ ] `test("repuesto bajo umbral: vehículo de flota, sin cotización, aprobación directa y OC con el equipo")`: nueva → Repuestos → `pickVehicle` → precio estimado `20000` × 1 → guardar → `openLatestDraft("REP")` → «Enviar a aprobación» → «Aprobar sin cotización» → confirmar → `expect(textoVisible("Aprobada"))` → `/compras/nueva` → `expect(textoVisible("E2E-FUEL-1"))`.
- [ ] `test("repuesto sobre umbral sin cotización queda bloqueado")`: precio estimado `900000` → enviar → `expect(getByText(/se necesita al menos una cotización/))`.
- [ ] Ajustar el test existente «enviar sin ninguna cotización queda bloqueado» al mensaje nuevo «Adjunta al menos una cotización o indica el precio unitario estimado…».
- [ ] `npm run test:e2e -- repuestos-servicios-oc-flow` PASS (en worktree desechable: la E2E borra `.next`) → Commit `test(e2e): repuestos con vehículo, umbral y aprobación sin cotización`.

### Task 19: E2E — OT y Control operacional

**Files:** Create `e2e/ot-repuestos.spec.ts`; Modify `e2e/control-operacional-navegacion.spec.ts`, `e2e/setup-db.ts` si hace falta una OC vinculada a `fuel-veh-e2e`. Usuarios: `jefe.mant@e2e.chome.cl` (`jefe_mantencion`), `mecanico1@…`. Locators según AGENTS.md (`getByRole`, `textoVisible`).
- [ ] `test("jefatura pide repuestos desde la OT y la OT los muestra como pedidos")`: crear OT (helper de `mantencion-5-ot.spec.ts`) → «Más acciones» → «Pedir repuestos» → `expect(page).toHaveURL(/\/solicitudes\/nueva\?tipo=repuestos&ot=/)` → completar y guardar borrador → volver a la OT → `getByRole("heading", { name: "Repuestos pedidos" })` y la fila `REP-` → en `/mantencion/ot` la fila dice «Esperando repuesto». `test("el mecánico no ve «Pedir repuestos»")`.
- [ ] `control-operacional-navegacion.spec.ts`: `test("el administrador ve «Repuestos y servicios (OC)» y «Mano de obra / taller (OT)» en la tabla")`.
- [ ] `npm run test:e2e -- ot-repuestos control-operacional-navegacion` PASS → Commit `test(e2e): repuestos desde la OT y columnas de compras`.

### Task 20: Verificación integral y evidencia

- [ ] `npm run typecheck`, `npm run lint`, `npm run test:fast`, `npm run test:pglite` (suites nuevas de a una si el `/dev/shm` las tumba), `npm run db:verify-migrations`, `npm run doctor`.
- [ ] `bodega_dev`: `npm run db:migrate` y `npm run db:sync-rbac`; `npm run db:generate` → «No schema changes».
- [ ] Recorrido en navegador (Playwright MCP, Chromium del repo, login por formulario esperando hidratación) con `jefe.mant`: OT → «Pedir repuestos» → formulario precargado → enviar bajo umbral; con `jefa`: aprobar sin cotización; con `secretaria`: OC desde `/compras/nueva` con el equipo visible; recepción en faena → notificación a mantención; Control operacional con las dos columnas nuevas y el tile «esperando repuesto»; ficha del equipo y de flota con compras. Capturas sin credenciales.
- [ ] Informe `qa/reports/repuestos-vinculados-2026-11-XX.md` con alcance cubierto, lo no recorrido y hallazgos; actualizar `ARCHITECTURE.md` sólo si `architecture-doc-rbac.test.ts` lo exige.
- [ ] Commit final `docs(qa): verificación de repuestos vinculados al equipo y a la OT`.

## Orden y paralelismo

- Secuencial: **T1 → T2 → T3**.
- En paralelo tras T3: **T4, T5, T6, T7, T9** (solicitudes/compras) y **T10** (mantención, sólo necesita T1).
- Tras T7: **T8**. Tras T10: **T11, T12, T13, T14** en paralelo. **T15, T16** sólo necesitan T1 y pueden ir en paralelo con la Fase C.
- Al final: **T17, T18, T19, T20**.
- Preferencia del usuario (memoria): plan integral, tareas independientes en paralelo con subagentes y pruebas al final; trabajar en un worktree (`superpowers:using-git-worktrees`) porque la E2E borra `.next` del checkout de desarrollo. Un worktree nuevo necesita `npm run prepare` para los hooks de husky.

## Seguimientos fuera de este plan
- Centro de costo nunca asignado en solicitudes ni OC (decisión pendiente: obligatorio al enviar o retirar del esquema).
- Catálogo mínimo de repuestos (producto con N° de parte; historial de precios; conciliación de facturas por SKU).
- Evento `parts_requested` en la bitácora de la OT (requiere migración del CHECK de eventos).
- Refactor de los flags posicionales de `COLUMNS`/`buildOperationalAssetExportColumns` a un objeto de opciones.
