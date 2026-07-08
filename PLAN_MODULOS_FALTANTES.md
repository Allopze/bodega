# Modulos Faltantes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every operational module into a complete workflow surface, not only a navigation entry. This plan covers missing options, categories, queues, actions, and cross-module handoffs found by reviewing the live `modules/*/manifest.ts`, `app/(app)/**`, `lib/services/**`, `db/schema/**`, and current E2E/test inventory.

**Scope:** This plan complements `PLAN_ADMINISTRACION_FALTANTES.md`. Pure admin catalog work stays in that file. This document focuses on module-facing capabilities: what a user should be able to do inside Solicitudes, Aprobaciones, Compras, Recepcion, Bodega, Entregas, Combustibles, Flota, Mantenciones, Prevencion, Reportes, Analitica, Trazabilidad, and Soporte.

**Architecture:** Keep the current project rule: live business logic belongs in `lib/` and route-level server actions belong in `app/(app)/**`. `modules/**/manifest.ts` remains the permission/navigation/seed surface only. Do not recreate removed `modules/*/services`, `modules/*/actions`, or `core/*` scaffolding.

**Tech Stack:** Next.js App Router, React Server Components, Server Actions, Drizzle ORM, PostgreSQL, Vitest, Testing Library, Playwright, existing `PageHeader`, `PageContainer`, `DataTable`, `ListFilters`, shared dialog/sheet components, audit logging, notifications, and XLSX-only exports.

---

## Current Module Inventory

The live module registry currently exposes these module manifests:

- `admin`
- `analytics`
- `approvals`
- `combustibles`
- `deliveries`
- `feedback`
- `flota`
- `mantenciones`
- `ppa`
- `prevention`
- `purchasing`
- `receiving`
- `reports`
- `repuestos`
- `requests`
- `servicios`
- `sst`
- `traceability`
- `warehouse`

Current top-level operational routes reviewed:

- `/solicitudes`
- `/aprobaciones`
- `/compras`
- `/recepcion`
- `/bodega`
- `/entregas`
- `/combustibles`
- `/flota`
- `/mantenciones`
- `/prevencion`
- `/prevencion/ppa`
- `/prevencion/pdtp`
- `/prevencion/documentacion`
- `/reportes`
- `/analitica`
- `/trazabilidad`
- `/soporte`

Module entries with no dedicated sidebar route:

- `repuestos`
- `servicios`

That is intentional in the current implementation because both live inside `/solicitudes` and detail routes `/repuestos/[id]` / `/servicios/[id]`. The missing work is not simply adding sidebar links; the missing work is making their quotation, approval, and OC handoff complete and visible.

---

## Main Gaps Found

### Solicitudes / Repuestos / Servicios

- `/solicitudes` lists mixed request types but has no first-class type filter/tabs for `EPP`, `Stock`, `Repuestos`, `Servicios`, `Mantencion`, and `Otro`.
- `app/(app)/solicitudes/request-list.tsx` renders type badges and redirects repuestos/servicios to their vertical detail pages, but the list still reads like a generic request inbox.
- `repuestos` and `servicios` have quotation upload, deletion, and selection actions.
- The quotation panels say selected items are ready for purchase order creation, and E2E checks that a "Nueva orden" entrypoint exists, but the workflow still needs a complete, auditable selected-quotation-to-OC bridge with supplier, items, prices, files, and blocked duplicate creation.
- Repuestos/servicios have no module dashboard/queue for "cotizaciones pendientes", "cotizacion seleccionada sin OC", "OC emitida", or "canceladas".

### Aprobaciones

- `/aprobaciones` is centered on request approval.
- The page explicitly excludes `repuestos` from the generic queue because those are approved through quotation selection.
- Quotation approvals are therefore operationally split from the main approval inbox and can be missed.
- Bulk approval exists for normal request items, but quotation-selection decisions do not have a consolidated queue, reason capture, or escalation state.

### Compras

- `/compras` shows approved items ready for OC and issued purchase orders.
- Purchase order detail has print/PDF, invoice attachments, reception shortcut, and informational reconciliation.
- Missing module actions: close OC with blocking rules, supplier confirmation workflow, invoice variance resolution, selected quotation provenance, and exception queue for partial/over-received/invoiced mismatches.
- Repuestos/servicios need a first-class OC creation path from the selected quotation rather than relying on implicit readiness.

### Recepcion

- Schema supports rejected/damaged/pending quantities through `receiptItems`.
- The receiving route focuses on registering receipts against OC.
- Missing module surface: incident queue, supplier claim flow, damaged/rejected evidence, reason capture, and follow-up status.

### Bodega

- Stock, movements, adjustments, returns, minimum stock, and physical inventory count closure exist.
- Missing module options: inter-faena transfers, stock reservations/commitments from approved requests, draft physical inventory sessions, cycle-count history, and reorder recommendations.

### Entregas

- Worker EPP delivery and proof attachment exist.
- Schema has signature fields, but the current UI does not expose a true digital signature capture flow.
- Missing module options: signature capture, bulk delivery, returned-EPP disposition, replacement lifecycle, and mobile-friendly delivery confirmation.

### Combustibles

- Fuel loads, vehicles, supplier current accounts, reports, import, and export exist.
- Live queries now apply faena scope for loads and vehicles.
- Missing module options: transactional statement/payment close, import duplicate detection, load lock after statement assignment, annulment workflow, and supplier account exception queue.

### Flota

- `/flota` exposes vehicle list, filters, documents, expiry alerts, and metrics.
- Missing module options: vehicle operational status changes, assignment/responsible history, utilization metrics, cost allocation rules, document requirement matrix by vehicle type, and handoff into mantenciones/combustibles.

### Mantenciones

- `/mantenciones` exposes creation, edit, filters, planning, history, cost centers, and vehicle integration.
- Missing module options: recurring maintenance plans by km/hours/date, closing/approval workflow, work evidence, spare-parts linkage, automatic reminders, and cost normalization rules.

### Prevencion / SST

- Evaluations, follow-ups, weekly evaluations, action plans, closing, archive/PDF, and section-level guards exist.
- Missing module options: action-plan board, owner assignment, overdue escalations, recurring follow-up calendar, dashboard filters, and formal evidence gallery.

### PPA

- PPA has list, stats, access panel, public token flow, offline flow, review/close/revoke token actions, and exports.
- Missing module options: token rotation policy, evidence attachments, control/task catalog linkage, offline conflict resolution review, and SLA alerts for pending public submissions.

### PDTP

- PDTP programs, activities, execution sheets, approval/legal signature, activation, overrides, and execution management exist.
- Missing module options: workbook import/export roundtrip, approval queue surfaced outside detail pages, overdue escalation, evidence review panel, and reusable activity/control catalogs.

### Documentacion SST

- Folder/document upload, categories, archive/restore/move, restricted/sensitive guards, and detail helpers exist.
- The detail helper currently returns disabled values for approval, acknowledgment, and linking capabilities.
- Missing module options: document approval workflow, worker acknowledgment, linked entities, expiry/responsible notifications, and review cadence.

### Reportes / Analitica / Trazabilidad

- `/reportes` has operational summaries and XLSX export dialogs.
- `/analitica` has KPI cards, charts, glossary, alerts, data gaps, filters, and XLSX export.
- `/trazabilidad` has lifecycle matrix and item detail.
- Missing module options: saved report views, scheduled XLSX delivery, exports preserving all filters, exception queues, drilldowns from KPI to row-level data, threshold settings, and reverse traceability.

### Soporte

- `/soporte` supports report creation, attachments, status changes, manager notes, basic SLA date, and notifications to managers.
- Missing module options: assignment, SLA queue, priority board, comments/threaded responses, linked route/entity, release/fix reference, and closure reason taxonomy.

---

## Cross-Cutting Rules

- Every authenticated page under `app/(app)/**` must use `PageContainer` and `PageHeader`.
- Do not add standalone text-search inputs when the route can use TopBar search or existing `ListFilters`.
- Use route-level structured filters for status, type, date, faena, responsible, vehicle, supplier, and exception state.
- Every mutation must enforce permissions with `requireAuth`, `can`, `guardPermission`, or the existing scoped guard for that module.
- Every mutation that changes operational state must record audit metadata or use an existing service that already records it.
- Every cross-module transition must be idempotent. A selected quotation must not create duplicate OCs; a receipt incident must not be registered twice; a stock transfer must not double-move inventory.
- Every export must be XLSX.
- Generate schema changes through Drizzle; do not edit migration SQL or journal files by hand.
- Keep old operational history readable after catalog changes.
- Prefer atomic transactions in `lib/services/**` for state transitions spanning multiple tables.
- Add notification rows only after the database mutation has succeeded.

---

## New Or Expanded Permissions

Add only when the action cannot be safely represented by existing permissions.

Recommended permission additions:

```ts
"requests:view_by_type",
"approvals:manage_quotations",
"purchasing:close_order",
"purchasing:reconcile_invoices",
"receiving:manage_incidents",
"warehouse:transfer_stock",
"warehouse:manage_counts",
"deliveries:capture_signature",
"deliveries:manage_returns",
"combustibles:manage_statements",
"combustibles:annul_loads",
"flota:manage_assignments",
"flota:manage_documents",
"mantenciones:close",
"mantenciones:manage_plans",
"sst:manage_action_plan",
"prevention:document_approve",
"prevention:document_ack",
"prevention:document_link",
"ppa:manage_tokens",
"pdtp:import_export",
"reports:schedule",
"analytics:configure",
"traceability:manage_exceptions",
"feedback:assign",
"feedback:comment",
```

Files:

- `modules/requests/manifest.ts`
- `modules/approvals/manifest.ts`
- `modules/purchasing/manifest.ts`
- `modules/receiving/manifest.ts`
- `modules/warehouse/manifest.ts`
- `modules/deliveries/manifest.ts`
- `modules/combustibles/manifest.ts`
- `modules/flota/manifest.ts`
- `modules/mantenciones/manifest.ts`
- `modules/sst/manifest.ts`
- `modules/prevention/manifest.ts`
- `modules/ppa/manifest.ts`
- `modules/reports/manifest.ts`
- `modules/analytics/manifest.ts`
- `modules/traceability/manifest.ts`
- `modules/feedback/manifest.ts`

Default grants:

- `administrador`: all new permissions.
- `jefa_chome`: all purchasing, receiving, warehouse, requests, approvals, reports, analytics, traceability, feedback management permissions.
- `secretaria`: request type views, purchasing reconciliation reads if applicable, receiving incidents, warehouse counts, feedback assignment/comments.
- `prevencionista`: SST, PPA, PDTP, prevention document, delivery return, and relevant reports/analytics permissions.
- `jefe_mantencion`: flota, mantenciones, combustibles operational permissions, plus repuestos/servicios quotation visibility.
- `bodeguero`: warehouse transfers/counts, receiving incidents, delivery signatures/returns.

Verification:

```bash
npx eslint modules
npm test -- lib/__tests__/auth-bootstrap-permissions.test.ts
```

Expected:

```text
0 problems
PASS lib/__tests__/auth-bootstrap-permissions.test.ts
```

---

## Phase 1: Solicitudes Type Workbench

**Purpose:** Make `/solicitudes` usable as a multi-module inbox instead of a flat list.

**Files:**

- Modify: `app/(app)/solicitudes/page.tsx`
- Modify: `app/(app)/solicitudes/request-list.tsx`
- Modify: `components/adquisiciones/list-filters.tsx`
- Modify: `lib/validation/request-filters.ts` or create `lib/validation/solicitudes-filters.ts`
- Test: `app/(app)/solicitudes/request-list.test.tsx`
- E2E: `e2e/request-flow.spec.ts`
- E2E: `e2e/repuestos-servicios-flow.spec.ts`

- [ ] Add URL filter `tipo` with allowed values from `db/schema/requests.ts`.
- [ ] Show type chips or segmented controls: `Todas`, `EPP`, `Stock`, `Repuestos`, `Servicios`, `Mantencion`, `Otro`.
- [ ] Preserve current `status`, `faena`, and `q` filters.
- [ ] Update server query to filter by `requests.requestType`.
- [ ] Add summary counters by type and state above the table.
- [ ] Keep `DETAIL_BASE` routing for repuestos and servicios.
- [ ] Make the empty state type-aware.

Implementation sketch:

```ts
const REQUEST_TYPE_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "epp", label: "EPP" },
  { value: "stock", label: "Stock" },
  { value: "repuestos", label: "Repuestos" },
  { value: "servicios", label: "Servicios" },
  { value: "mantencion", label: "Mantencion" },
  { value: "otro", label: "Otro" },
] as const
```

Verification:

```bash
npx eslint 'app/(app)/solicitudes/page.tsx' 'app/(app)/solicitudes/request-list.tsx'
npm test -- 'app/(app)/solicitudes/request-list.test.tsx'
npx playwright test e2e/request-flow.spec.ts e2e/repuestos-servicios-flow.spec.ts
```

Expected:

```text
0 problems
PASS app/(app)/solicitudes/request-list.test.tsx
2 passed
```

---

## Phase 2: Repuestos And Servicios Work Queues

**Purpose:** Give repuestos and servicios their own operational queues without duplicating the request creation model.

**Files:**

- Add: `app/(app)/repuestos/page.tsx`
- Add: `app/(app)/servicios/page.tsx`
- Add: `app/(app)/repuestos/repuestos-workbench.tsx`
- Add: `app/(app)/servicios/servicios-workbench.tsx`
- Modify: `modules/repuestos/manifest.ts`
- Modify: `modules/servicios/manifest.ts`
- Modify: `components/layout/nav-items.ts` if registry-driven nav does not pick up new entries automatically
- Test: `app/(app)/repuestos/actions.test.ts`
- Test: `app/(app)/servicios/actions.test.ts`
- E2E: `e2e/repuestos-servicios-flow.spec.ts`

- [ ] Add a dedicated page for repuestos with cards: `Borradores`, `En cotizacion`, `Cotizacion seleccionada`, `Listos para OC`, `Con OC`, `Cancelados`.
- [ ] Add a dedicated page for servicios with the same operational states.
- [ ] Keep creation through `/solicitudes/nueva?tipo=repuestos` and `/solicitudes/nueva?tipo=servicios`.
- [ ] Add `PageHeader actions` for "Nueva solicitud".
- [ ] Add permission-gated visibility using `repuestos:view_all`, `repuestos:view_own`, `servicios:view_all`, and `servicios:view_own`.
- [ ] Add a table row action to continue quotation work on `/repuestos/[id]` or `/servicios/[id]`.
- [ ] Add counters for requests with selected quotation but no OC.
- [ ] Decide whether these pages should appear in the sidebar. If yes, add nav entries under the procurement group with concise labels `Repuestos` and `Servicios`.

Service function shape:

```ts
export async function listRepuestoWorkbenchRows(scope: RequestScope, filters: RepuestoWorkbenchFilters) {
  return db
    .select()
    .from(requests)
    .where(buildRepuestoWorkbenchWhere(scope, filters))
}
```

Verification:

```bash
npx eslint 'app/(app)/repuestos' 'app/(app)/servicios' modules/repuestos/manifest.ts modules/servicios/manifest.ts
npm test -- 'app/(app)/repuestos/actions.test.ts' 'app/(app)/servicios/actions.test.ts'
npx playwright test e2e/repuestos-servicios-flow.spec.ts
```

Expected:

```text
0 problems
PASS app/(app)/repuestos/actions.test.ts
PASS app/(app)/servicios/actions.test.ts
1 passed
```

---

## Phase 3: Selected Quotation To Purchase Order

**Purpose:** Complete the bridge from selected repuesto/servicio quotation to OC.

**Files:**

- Modify: `lib/services/repuestos.ts`
- Modify: `lib/services/servicios.ts`
- Modify: `lib/requests/request-actions.ts`
- Modify: `lib/services/purchasing.ts`
- Modify: `app/(app)/compras/actions.ts`
- Modify: `app/(app)/compras/nueva/page.tsx`
- Modify: `app/(app)/compras/nueva/order-form.tsx`
- Modify: `app/(app)/repuestos/quotation-panel.tsx`
- Modify: `app/(app)/servicios/quotation-panel.tsx`
- E2E: `e2e/repuestos-servicios-oc-flow.spec.ts`

- [ ] Add a canonical service method `createPurchaseOrderFromSelectedQuotation`.
- [ ] Accept `requestId`, `requestType`, and selected `quotationId`.
- [ ] Resolve supplier from selected quotation; if the supplier is free text, require mapping to an existing supplier before OC creation.
- [ ] Carry quotation file reference into the OC detail as provenance.
- [ ] Copy selected quotation prices into OC line items.
- [ ] Block duplicate OC creation for the same selected quotation.
- [ ] Record audit events for quotation selection and OC creation.
- [ ] Notify purchasing users after selection if the requester cannot create OC.
- [ ] Add an explicit CTA on quotation panels: `Crear OC`.
- [ ] If the selected quotation already has an OC, replace CTA with `Ver OC`.

Atomic service shape:

```ts
export async function createPurchaseOrderFromSelectedQuotation(input: {
  requestId: string
  quotationId: string
  requestType: "repuestos" | "servicios"
  supplierId: string
  actorId: string
}) {
  return db.transaction(async (tx) => {
    const quotation = await getSelectedQuotationForUpdate(tx, input)
    await assertNoPurchaseOrderForQuotation(tx, quotation.id)
    const order = await createOrderFromQuotationTx(tx, quotation, input)
    await markItemsLinkedToOrderTx(tx, input.requestId, order.id)
    await recordAuditTx(tx, "purchase_order.created_from_quotation", order.id, input.actorId)
    return order
  })
}
```

Verification:

```bash
npx eslint 'lib/services/repuestos.ts' 'lib/services/servicios.ts' 'lib/services/purchasing.ts' 'app/(app)/compras' 'app/(app)/repuestos' 'app/(app)/servicios'
npm test -- 'app/(app)/repuestos/actions.test.ts' 'app/(app)/servicios/actions.test.ts'
npx playwright test e2e/repuestos-servicios-oc-flow.spec.ts
```

Expected:

```text
0 problems
PASS app/(app)/repuestos/actions.test.ts
PASS app/(app)/servicios/actions.test.ts
1 passed
```

---

## Phase 4: Approval Queue For Quotation Decisions

**Purpose:** Prevent repuestos/servicios quotation decisions from living outside the main approval operation.

**Files:**

- Modify: `app/(app)/aprobaciones/page.tsx`
- Add: `app/(app)/aprobaciones/quotation-approval-list.tsx`
- Modify: `app/(app)/aprobaciones/actions.ts`
- Modify: `modules/approvals/manifest.ts`
- Test: `app/(app)/aprobaciones/actions.test.ts`
- E2E: `e2e/approval-flow.spec.ts`
- E2E: `e2e/repuestos-servicios-oc-flow.spec.ts`

- [ ] Add tabs or segmented controls: `Solicitudes`, `Cotizaciones`, `Excepciones`.
- [ ] Show repuestos/servicios with pending quotations in `Cotizaciones`.
- [ ] Require `approvals:manage_quotations` for selection from this queue.
- [ ] Capture selected supplier, amount, justification, and optional comment.
- [ ] Reuse existing repuestos/servicios selection actions where possible.
- [ ] After selection, show whether OC is pending or already created.
- [ ] Add a row-level shortcut to `Crear OC` when user has purchasing permission.

Verification:

```bash
npx eslint 'app/(app)/aprobaciones'
npm test -- 'app/(app)/aprobaciones/actions.test.ts'
npx playwright test e2e/approval-flow.spec.ts e2e/repuestos-servicios-oc-flow.spec.ts
```

Expected:

```text
0 problems
PASS app/(app)/aprobaciones/actions.test.ts
2 passed
```

---

## Phase 5: Purchase Order Close And Invoice Reconciliation

**Purpose:** Move OC detail from informational reconciliation to actionable close control.

**Files:**

- Modify: `db/schema/purchasing.ts`
- Modify: `lib/services/purchasing.ts`
- Modify: `app/(app)/compras/[id]/page.tsx`
- Add: `app/(app)/compras/[id]/reconciliation-panel.tsx`
- Modify: `app/(app)/compras/actions.ts`
- Test: `lib/__tests__/purchasing-reconciliation.test.ts`
- E2E: `e2e/purchase-flow.spec.ts`

- [ ] Add close action requiring `purchasing:close_order`.
- [ ] Block close when received quantity is lower than ordered and no variance reason exists.
- [ ] Block close when invoice total exceeds configured tolerance and no variance reason exists.
- [ ] Add `supplier_confirmed` transition from OC detail.
- [ ] Add invoice matching state: `sin_factura`, `parcial`, `calzada`, `con_diferencia`.
- [ ] Add variance reason fields if current invoice attachment model cannot store them.
- [ ] Preserve print/PDF actions.
- [ ] Add audit events for confirm, reconcile, and close.
- [ ] Add notifications for purchasing users on mismatches.

Schema addition if needed:

```ts
export const purchaseOrderReconciliations = pgTable("purchase_order_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  status: varchar("status", { length: 32 }).notNull(),
  varianceReason: text("variance_reason"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
```

Verification:

```bash
npm run db:generate
npm test -- lib/__tests__/purchasing-reconciliation.test.ts
npx eslint 'app/(app)/compras' lib/services/purchasing.ts
npx playwright test e2e/purchase-flow.spec.ts
```

Expected:

```text
No schema changes
PASS lib/__tests__/purchasing-reconciliation.test.ts
1 passed
```

---

## Phase 6: Receiving Incidents

**Purpose:** Expose damaged/rejected quantities as a first-class receiving workflow.

**Files:**

- Modify: `app/(app)/recepcion/page.tsx`
- Modify: `app/(app)/recepcion/nueva/page.tsx`
- Modify: `app/(app)/recepcion/actions.ts`
- Add: `app/(app)/recepcion/incidencias/page.tsx`
- Add: `app/(app)/recepcion/incidencias/incident-list.tsx`
- Modify: `lib/services/receiving.ts`
- Test: `lib/__tests__/receiving-incidents.test.ts`
- E2E: `e2e/receiving-flow.spec.ts`

- [ ] Add fields for damaged quantity, rejected quantity, reason, and evidence attachment during receipt.
- [ ] Create incident records for damaged/rejected receipt items.
- [ ] Add `/recepcion/incidencias` with filters by supplier, OC, faena, status, and date.
- [ ] Add incident states: `abierta`, `reclamada`, `resuelta`, `anulada`.
- [ ] Link incidents to OC detail.
- [ ] Notify purchasing users when incidents are opened.
- [ ] Prevent stock increase for rejected quantities.
- [ ] Add audit event for incident creation and resolution.

Verification:

```bash
npm run db:generate
npm test -- lib/__tests__/receiving-incidents.test.ts
npx eslint 'app/(app)/recepcion' lib/services/receiving.ts
npx playwright test e2e/receiving-flow.spec.ts
```

Expected:

```text
No schema changes
PASS lib/__tests__/receiving-incidents.test.ts
1 passed
```

---

## Phase 7: Warehouse Transfers, Reservations, And Count Sessions

**Purpose:** Make Bodega support real inventory operations across faenas.

**Files:**

- Modify: `db/schema/stock.ts`
- Modify: `lib/services/stock.ts`
- Modify: `app/(app)/bodega/page.tsx`
- Add: `app/(app)/bodega/transfer-panel.tsx`
- Add: `app/(app)/bodega/reservations-panel.tsx`
- Modify: `app/(app)/bodega/physical-inventory-panel.tsx`
- Modify: `app/(app)/bodega/actions.ts`
- Test: `lib/__tests__/stock-transfers.test.ts`
- Test: `lib/__tests__/stock-reservations.test.ts`
- E2E: `e2e/bodega-conteo.spec.ts`

- [ ] Add inter-faena transfer action requiring `warehouse:transfer_stock`.
- [ ] Model transfer as paired stock movements inside a transaction.
- [ ] Prevent transfer from faenas outside the actor scope.
- [ ] Add reservation rows for approved requests waiting delivery or purchase.
- [ ] Show available stock as `stock actual - reservado`.
- [ ] Add draft physical inventory count sessions with save/resume.
- [ ] Add count history table and variance filters.
- [ ] Add reorder recommendations from min stock, available stock, and recent consumption.

Transfer service shape:

```ts
export async function transferStock(input: {
  productId: string
  fromWorksiteId: string
  toWorksiteId: string
  quantity: number
  reason: string
  actorId: string
}) {
  return db.transaction(async (tx) => {
    await assertScopedWorksites(tx, input.actorId, [input.fromWorksiteId, input.toWorksiteId])
    await createStockMovementTx(tx, { type: "transfer_out", quantity: -input.quantity })
    await createStockMovementTx(tx, { type: "transfer_in", quantity: input.quantity })
    await recordAuditTx(tx, "stock.transfer", input.productId, input.actorId)
  })
}
```

Verification:

```bash
npm run db:generate
npm test -- lib/__tests__/stock-transfers.test.ts lib/__tests__/stock-reservations.test.ts
npx eslint 'app/(app)/bodega' lib/services/stock.ts
npx playwright test e2e/bodega-conteo.spec.ts
```

Expected:

```text
No schema changes
PASS lib/__tests__/stock-transfers.test.ts
PASS lib/__tests__/stock-reservations.test.ts
1 passed
```

---

## Phase 8: Delivery Signature And Return Lifecycle

**Purpose:** Use the signature fields already present in delivery data and close the returned-EPP loop.

**Files:**

- Modify: `app/(app)/entregas/page.tsx`
- Add: `app/(app)/entregas/signature-pad.tsx`
- Add: `app/(app)/entregas/return-disposition-panel.tsx`
- Modify: `app/(app)/entregas/actions.ts`
- Modify: `lib/services/deliveries.ts`
- Test: `lib/__tests__/worker-delivery-signature.test.ts`
- E2E: `e2e/worker-delivery-flow.spec.ts`

- [ ] Add digital signature capture before registering delivery.
- [ ] Store signature file path and signer metadata.
- [ ] Keep uploaded proof attachment support.
- [ ] Add return disposition values: `reutilizable`, `desechar`, `en_revision`, `perdido`.
- [ ] Require reason for `desechar` and `perdido`.
- [ ] Link returned EPP to replacement delivery when applicable.
- [ ] Add print/PDF proof that includes signature.
- [ ] Add mobile viewport E2E coverage.

Verification:

```bash
npm test -- lib/__tests__/worker-delivery-signature.test.ts
npx eslint 'app/(app)/entregas' lib/services/deliveries.ts
npx playwright test e2e/worker-delivery-flow.spec.ts --project=chromium
```

Expected:

```text
PASS lib/__tests__/worker-delivery-signature.test.ts
1 passed
```

---

## Phase 9: Combustibles Statement Integrity

**Purpose:** Make fuel supplier accounts financially reliable.

**Files:**

- Modify: `lib/combustibles/queries.ts`
- Modify: `app/(app)/combustibles/actions-module/loads.ts`
- Modify: `app/(app)/combustibles/actions-module/statements.ts`
- Modify: `app/(app)/combustibles/cuenta-corriente/page.tsx`
- Add: `app/(app)/combustibles/cuenta-corriente/exceptions-panel.tsx`
- Test: `app/(app)/combustibles/actions-module/statements.test.ts`
- Test: `app/(app)/combustibles/actions-module/loads.test.ts`
- E2E: `e2e/combustibles-flow.spec.ts`

- [ ] Wrap statement creation and payment registration in transactions.
- [ ] Add duplicate import detection by supplier, document number, vehicle, date, liters, and amount.
- [ ] Prevent deletion of fuel loads already assigned to a non-cancelled statement.
- [ ] Add annulment action requiring `combustibles:annul_loads`.
- [ ] Add current-account exceptions: duplicate candidate, missing vehicle, missing supplier, amount mismatch, overdue statement.
- [ ] Notify responsible users for overdue statements.
- [ ] Keep XLSX export only.

Verification:

```bash
npm test -- 'app/(app)/combustibles/actions-module/statements.test.ts' 'app/(app)/combustibles/actions-module/loads.test.ts'
npx eslint 'app/(app)/combustibles' lib/combustibles/queries.ts
npx playwright test e2e/combustibles-flow.spec.ts
```

Expected:

```text
PASS app/(app)/combustibles/actions-module/statements.test.ts
PASS app/(app)/combustibles/actions-module/loads.test.ts
1 passed
```

---

## Phase 10: Flota Assignments And Vehicle Rules

**Purpose:** Turn Flota from a catalog/report screen into an operational ownership surface.

**Files:**

- Modify: `db/schema/vehicles.ts`
- Modify: `lib/services/vehicles.ts`
- Modify: `app/(app)/flota/page.tsx`
- Add: `app/(app)/flota/[id]/page.tsx`
- Add: `app/(app)/flota/[id]/assignment-panel.tsx`
- Add: `app/(app)/flota/[id]/document-rule-panel.tsx`
- Test: `lib/__tests__/vehicle-assignments.test.ts`
- E2E: `e2e/flota.spec.ts`
- E2E: `e2e/flota-documentos.spec.ts`

- [ ] Add vehicle detail page.
- [ ] Add assignment/responsible history with start/end dates.
- [ ] Add operational status changes with reason.
- [ ] Add required document matrix by vehicle type.
- [ ] Add utilization metrics from fuel and maintenance activity.
- [ ] Link vehicle detail to combustibles and mantenciones filtered by vehicle.
- [ ] Add audit events for assignment and status changes.

Verification:

```bash
npm run db:generate
npm test -- lib/__tests__/vehicle-assignments.test.ts
npx eslint 'app/(app)/flota' lib/services/vehicles.ts
npx playwright test e2e/flota.spec.ts e2e/flota-documentos.spec.ts
```

Expected:

```text
No schema changes
PASS lib/__tests__/vehicle-assignments.test.ts
2 passed
```

---

## Phase 11: Maintenance Plans, Close, And Evidence

**Purpose:** Make Mantenciones cover scheduling, execution, closing, and cost review.

**Files:**

- Modify: `db/schema/maintenance.ts`
- Modify: `lib/services/maintenance.ts`
- Modify: `app/(app)/mantenciones/page.tsx`
- Add: `app/(app)/mantenciones/planes/page.tsx`
- Add: `app/(app)/mantenciones/[id]/page.tsx`
- Add: `app/(app)/mantenciones/[id]/close-panel.tsx`
- Modify: `app/(app)/mantenciones/actions.ts`
- Test: `lib/__tests__/maintenance-plans.test.ts`
- E2E: `e2e/mantenciones.spec.ts`

- [ ] Add recurring plans by date, km, and engine hours.
- [ ] Generate upcoming maintenance reminders.
- [ ] Add detail page with evidence attachments.
- [ ] Add close action requiring `mantenciones:close`.
- [ ] Add approval action for high-cost maintenance if business rules require it.
- [ ] Link spare parts used to repuestos or stock movements.
- [ ] Normalize cost fields so net, tax, and total are not double-counted.
- [ ] Add cost center validation.

Verification:

```bash
npm run db:generate
npm test -- lib/__tests__/maintenance-plans.test.ts
npx eslint 'app/(app)/mantenciones' lib/services/maintenance.ts
npx playwright test e2e/mantenciones.spec.ts
```

Expected:

```text
No schema changes
PASS lib/__tests__/maintenance-plans.test.ts
1 passed
```

---

## Phase 12: SST Action Plan Board

**Purpose:** Make SST follow-up work visible and assignable.

**Files:**

- Modify: `app/(app)/prevencion/page.tsx`
- Modify: `app/(app)/prevencion/actions/action-plan.ts`
- Modify: `app/(app)/prevencion/actions/followups.ts`
- Add: `app/(app)/prevencion/plan-accion/page.tsx`
- Add: `app/(app)/prevencion/plan-accion/action-plan-board.tsx`
- Test: `app/(app)/prevencion/actions/action-plan.test.ts`
- E2E: `e2e/prevencion-flow.spec.ts`

- [ ] Add board columns: `Pendiente`, `En curso`, `Bloqueada`, `Vencida`, `Cerrada`.
- [ ] Add owner assignment and due date editing.
- [ ] Add follow-up calendar view.
- [ ] Add evidence attachments per action item.
- [ ] Add overdue notification job or reusable notification service call.
- [ ] Add filters by worker, faena, owner, status, and due date.
- [ ] Link evaluation detail to board item.

Verification:

```bash
npm test -- 'app/(app)/prevencion/actions/action-plan.test.ts'
npx eslint 'app/(app)/prevencion'
npx playwright test e2e/prevencion-flow.spec.ts
```

Expected:

```text
PASS app/(app)/prevencion/actions/action-plan.test.ts
1 passed
```

---

## Phase 13: Documentacion SST Approval, Acknowledgment, And Links

**Purpose:** Activate document lifecycle capabilities currently represented as disabled detail flags.

**Files:**

- Modify: `db/schema/sst.ts`
- Modify: `app/(app)/prevencion/documentacion/page.tsx`
- Modify: `app/(app)/prevencion/documentacion/actions.ts`
- Add: `app/(app)/prevencion/documentacion/[id]/page.tsx`
- Add: `app/(app)/prevencion/documentacion/[id]/approval-panel.tsx`
- Add: `app/(app)/prevencion/documentacion/[id]/ack-panel.tsx`
- Add: `app/(app)/prevencion/documentacion/[id]/links-panel.tsx`
- Test: `app/(app)/prevencion/documentacion/actions.test.ts`
- E2E: `e2e/prevencion-documentacion.spec.ts`

- [ ] Add document statuses: `borrador`, `en_revision`, `aprobado`, `rechazado`, `archivado`.
- [ ] Add approval action requiring `prevention:document_approve`.
- [ ] Add acknowledgment assignment to workers, roles, or faenas requiring `prevention:document_ack`.
- [ ] Add linked entity support for worker, faena, vehicle, maintenance, EPP delivery, PPA, and PDTP.
- [ ] Add expiry/responsible notification creation.
- [ ] Replace disabled detail helper values with permission-aware booleans.
- [ ] Show acknowledgment progress and missing acknowledgments.

Verification:

```bash
npm run db:generate
npm test -- 'app/(app)/prevencion/documentacion/actions.test.ts'
npx eslint 'app/(app)/prevencion/documentacion'
npx playwright test e2e/prevencion-documentacion.spec.ts
```

Expected:

```text
No schema changes
PASS app/(app)/prevencion/documentacion/actions.test.ts
1 passed
```

---

## Phase 14: PPA Evidence And Token Governance

**Purpose:** Make public PPA submissions auditable and manageable after issuance.

**Files:**

- Modify: `app/(app)/prevencion/ppa/page.tsx`
- Modify: `app/(app)/prevencion/ppa/actions.ts`
- Modify: `app/(public)/ppa/ppa-form.tsx`
- Modify: `app/(public)/ppa/ppa-form.hooks.ts`
- Modify: `app/(public)/ppa/offline-saved.tsx`
- Add: `app/(app)/prevencion/ppa/token-policy-panel.tsx`
- Test: `app/(app)/prevencion/ppa/actions.test.ts`
- E2E: `e2e/ppa-flow.spec.ts`
- E2E: `e2e/ppa-offline.spec.ts`

- [ ] Add token rotation action requiring `ppa:manage_tokens`.
- [ ] Add token expiry presets and manual revoke reason.
- [ ] Add evidence attachments to public PPA responses.
- [ ] Add conflict review for offline submissions that arrive after token changes or duplicated response codes.
- [ ] Link PPA controls to a managed control catalog.
- [ ] Notify prevention users for public submissions pending review beyond SLA.
- [ ] Keep public form resilient offline and verify current PPA changes in the dirty tree before editing.

Verification:

```bash
npm test -- 'app/(app)/prevencion/ppa/actions.test.ts'
npx eslint 'app/(app)/prevencion/ppa' 'app/(public)/ppa'
npx playwright test e2e/ppa-flow.spec.ts e2e/ppa-offline.spec.ts
```

Expected:

```text
PASS app/(app)/prevencion/ppa/actions.test.ts
2 passed
```

---

## Phase 15: PDTP Import, Export, And Review Queue

**Purpose:** Make PDTP sustainable for workbook-backed preventive program management.

**Files:**

- Modify: `app/(app)/prevencion/pdtp/page.tsx`
- Modify: `app/(app)/prevencion/pdtp/actions.ts`
- Add: `app/(app)/prevencion/pdtp/import/page.tsx`
- Add: `app/(app)/prevencion/pdtp/revision/page.tsx`
- Add: `lib/services/pdtp-import-export.ts`
- Test: `app/(app)/prevencion/pdtp/actions.test.ts`
- Test: `lib/__tests__/pdtp-import-export.test.ts`
- E2E: `e2e/pdtp-flow.spec.ts`

- [ ] Add XLSX import for program/activity templates.
- [ ] Add XLSX export that can be re-imported without losing identifiers.
- [ ] Add review queue for pending approval/legal signature.
- [ ] Add evidence review panel for executions.
- [ ] Add overdue escalation for missed activities.
- [ ] Link PDTP activity catalogs to admin PDTP catalogs from `PLAN_ADMINISTRACION_FALTANTES.md`.
- [ ] Add row-level validation errors for import preview.

Verification:

```bash
npm test -- 'app/(app)/prevencion/pdtp/actions.test.ts' lib/__tests__/pdtp-import-export.test.ts
npx eslint 'app/(app)/prevencion/pdtp' lib/services/pdtp-import-export.ts
npx playwright test e2e/pdtp-flow.spec.ts
```

Expected:

```text
PASS app/(app)/prevencion/pdtp/actions.test.ts
PASS lib/__tests__/pdtp-import-export.test.ts
1 passed
```

---

## Phase 16: Reports, Analytics, And Traceability Drilldowns

**Purpose:** Turn read-only summaries into actionable reporting surfaces.

**Files:**

- Modify: `app/(app)/reportes/page.tsx`
- Modify: `app/(app)/analitica/page.tsx`
- Modify: `app/(app)/trazabilidad/page.tsx`
- Modify: `app/(app)/trazabilidad/[itemId]/page.tsx`
- Modify: `app/api/reportes/export/route.ts`
- Add: `lib/services/report-views.ts`
- Add: `lib/services/report-schedules.ts`
- Test: `lib/__tests__/report-views.test.ts`
- Test: `lib/__tests__/traceability-filters.test.ts`
- E2E: `e2e/export-volume.spec.ts`
- E2E: `e2e/traceability-flow.spec.ts`

- [ ] Add saved report views per user.
- [ ] Add scheduled XLSX exports requiring `reports:schedule`.
- [ ] Preserve all filters in export URLs, including trazabilidad `estado`.
- [ ] Add KPI drilldowns from `/analitica` to filtered source rows.
- [ ] Add threshold settings requiring `analytics:configure`.
- [ ] Add exception queues: approved without OC, OC without receipt, received without delivery, stock negative, overdue PPA/PDTP.
- [ ] Add reverse traceability from product, worker, supplier, OC, vehicle, and request.

Verification:

```bash
npm test -- lib/__tests__/report-views.test.ts lib/__tests__/traceability-filters.test.ts
npx eslint 'app/(app)/reportes' 'app/(app)/analitica' 'app/(app)/trazabilidad' app/api/reportes/export/route.ts
npx playwright test e2e/export-volume.spec.ts e2e/traceability-flow.spec.ts
```

Expected:

```text
PASS lib/__tests__/report-views.test.ts
PASS lib/__tests__/traceability-filters.test.ts
2 passed
```

---

## Phase 17: Soporte Assignment, Comments, And SLA Board

**Purpose:** Make Soporte usable as an internal work queue, not only a report inbox.

**Files:**

- Modify: `db/schema/feedback.ts`
- Modify: `lib/services/feedback.ts`
- Modify: `app/(app)/soporte/page.tsx`
- Modify: `app/(app)/soporte/report-list.tsx`
- Modify: `app/(app)/soporte/[id]/page.tsx`
- Modify: `app/(app)/soporte/[id]/status-panel.tsx`
- Add: `app/(app)/soporte/[id]/comments-panel.tsx`
- Add: `app/(app)/soporte/sla-board.tsx`
- Modify: `app/(app)/soporte/actions.ts`
- Test: `lib/__tests__/feedback-sla.test.ts`
- E2E: `e2e/soporte.spec.ts`

- [ ] Add assignment to a responsible user requiring `feedback:assign`.
- [ ] Add comments visible to reporter and managers.
- [ ] Keep internal note private to managers.
- [ ] Add closure reason: `resuelto`, `duplicado`, `no_reproducible`, `fuera_de_alcance`, `descartado`.
- [ ] Add linked route/entity fields so a support report can point to a request, OC, worker, vehicle, document, or PPA.
- [ ] Add SLA board filters: `Vencidos`, `Vencen hoy`, `Sin responsable`, `Alta prioridad`, `Resueltos`.
- [ ] Notify assigned users and reporters on comments/status changes.

Verification:

```bash
npm run db:generate
npm test -- lib/__tests__/feedback-sla.test.ts
npx eslint 'app/(app)/soporte' lib/services/feedback.ts
npx playwright test e2e/soporte.spec.ts
```

Expected:

```text
No schema changes
PASS lib/__tests__/feedback-sla.test.ts
1 passed
```

---

## Phase 18: Notification Maintenance Across Modules

**Purpose:** Centralize operational notification cleanup and module-triggered reminders without duplicating admin maintenance work.

**Files:**

- Modify: `lib/services/notifications.ts`
- Modify: `db/schema/audit.ts`
- Add: `lib/services/notification-rules.ts`
- Add: `app/(app)/notificaciones/preferencias/page.tsx` if user-level preferences are needed outside admin
- Test: `lib/__tests__/notification-rules.test.ts`

- [ ] Add reusable notification rule helpers for overdue PPA, overdue PDTP, document expiry, fuel statement overdue, receiving incidents, OC mismatches, support assignment, and maintenance reminders.
- [ ] Add dedupe keys per entity and event type.
- [ ] Add module source field if current notification rows cannot distinguish origins.
- [ ] Add user-level preference surface only for personal notification preferences.
- [ ] Keep system-wide notification maintenance in `PLAN_ADMINISTRACION_FALTANTES.md`.

Verification:

```bash
npm run db:generate
npm test -- lib/__tests__/notification-rules.test.ts
npx eslint lib/services/notifications.ts lib/services/notification-rules.ts
```

Expected:

```text
No schema changes
PASS lib/__tests__/notification-rules.test.ts
```

---

## Phase 19: Route Capture, Manuals, And Regression Matrix

**Purpose:** Keep the module expansion visible in captures, manual docs, and route inventories.

**Files:**

- Modify: `scripts/capture-all-routes.ts`
- Modify: `docs/manuales/MANUAL_MODULOS_CHOME.md`
- Modify: `docs/auditoria/AUDITORIA_MODULOS_CHOME.md`
- Modify: `README.md` only if it links module docs
- Add or update E2E files listed in each phase

- [ ] Add every new route to route capture inventory.
- [ ] Update end-user manual with click-by-click instructions.
- [ ] Update module audit table after implementation evidence exists.
- [ ] Add screenshots for new module queues where the capture script expects them.
- [ ] Run broad capture only after targeted E2E is green.

Verification:

```bash
npm run lint
npm run typecheck
npm test
npx playwright test e2e/repuestos-servicios-oc-flow.spec.ts e2e/purchase-flow.spec.ts e2e/receiving-flow.spec.ts e2e/bodega-conteo.spec.ts e2e/worker-delivery-flow.spec.ts e2e/combustibles-flow.spec.ts e2e/flota.spec.ts e2e/mantenciones.spec.ts e2e/ppa-flow.spec.ts e2e/pdtp-flow.spec.ts e2e/prevencion-documentacion.spec.ts e2e/soporte.spec.ts
```

Expected:

```text
0 problems
typecheck passed
all targeted tests passed
```

---

## Suggested Implementation Order

1. Solicitudes type workbench.
2. Repuestos/Servicios work queues.
3. Selected quotation to OC.
4. Aprobaciones quotation queue.
5. Compras close and invoice reconciliation.
6. Recepcion incidents.
7. Bodega transfers/reservations/count sessions.
8. Entregas signature/returns.
9. Combustibles statement integrity.
10. Flota detail/assignments/document rules.
11. Mantenciones plans/close/evidence.
12. SST action plan board.
13. Documentacion SST approval/ack/links.
14. PPA evidence/token governance.
15. PDTP import/export/review.
16. Reports/Analytics/Traceability drilldowns.
17. Soporte SLA board.
18. Notification rules.
19. Documentation/captures/regression matrix.

This order keeps procurement handoffs first because they connect the most modules: Solicitudes -> Aprobaciones -> Compras -> Recepcion -> Bodega -> Entregas -> Trazabilidad.

---

## Release Gates

Before merging any phase:

- [ ] Targeted unit tests pass.
- [ ] Targeted E2E passes or the skipped part is documented with a concrete blocker.
- [ ] `npx eslint <changed files>` passes.
- [ ] New pages use `PageHeader` and `PageContainer`.
- [ ] New exports are XLSX.
- [ ] Permissions are represented in the module manifest and granted through seed/bootstrap.
- [ ] Mutations are scoped by faena where applicable.
- [ ] Cross-module transitions are idempotent.
- [ ] Audit/notification behavior is covered for state changes.

Before considering the whole plan complete:

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] Targeted Playwright matrix from Phase 19.
- [ ] `scripts/capture-all-routes.ts` updated and route capture verified.
- [ ] `docs/manuales/MANUAL_MODULOS_CHOME.md` updated from current UI labels.
- [ ] `docs/auditoria/AUDITORIA_MODULOS_CHOME.md` updated from live verification.

---

## Definition Of Done

The module layer is complete when a normal operator can:

- Filter and act on every request type from `/solicitudes`.
- Manage repuestos/servicios quotation queues without losing the OC handoff.
- Approve normal requests and quotation decisions from `/aprobaciones`.
- Create, confirm, reconcile, receive, and close OCs with visible exceptions.
- Register receipt incidents and follow them to resolution.
- Transfer/reserve/count stock by faena.
- Deliver EPP with signature and manage returned equipment.
- Manage fuel statements/payments without duplicate or orphan loads.
- See vehicle assignments, document rules, and vehicle-linked activity.
- Plan, execute, evidence, and close maintenance.
- Track SST action plans, document acknowledgments, PPA evidence, and PDTP reviews.
- Drill from reports/analytics/traceability into actionable rows.
- Manage support reports through assignment, comments, SLA, and closure reason.

At that point, `PLAN_ADMINISTRACION_FALTANTES.md` covers the administrative setup layer and this file covers the operational module layer.
