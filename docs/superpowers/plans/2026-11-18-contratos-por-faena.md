# Contratos dentro de la faena — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada faena tenga contratos, que cada equipo de flota pertenezca a un contrato a la vez (con fechas) y que el costo por equipo del Panel operacional se vea separado por contrato.

**Architecture:** Se reutiliza `contracts` (Facturación) como único contrato y se agrega `contract_vehicle_assignments` (equipo → contrato, `valid_from`/`valid_to` inclusivos). El costo se atribuye con una función pura sobre partidas fechadas que salen de variantes «por día» de las mismas consultas que hoy alimentan el costo por equipo del Panel, de modo que exista una sola definición de costo. Tres superficies: detalle de faena `/admin/faenas/[id]`, ficha del equipo `/flota/[id]` y sección «Costo por contrato» en `/control-operacional`.

**Tech Stack:** Next.js 16 (App Router, server actions; `params`/`searchParams` son `Promise`), Drizzle + Postgres, Vitest (`test:fast` y `test:pglite`), Playwright, exceljs.

**Spec:** `docs/superpowers/specs/2026-11-18-contratos-por-faena-design.md` — leerlo antes de cada tarea.

## Global Constraints

- La faena sigue siendo el único eje de alcance. Un contrato nunca entra en `worksite_users`, en selectores de faena ni en `worksiteScopeSql`. Toda action valida `canAccessWorksite(session, contract.worksiteId)`.
- Nada se prorratea. Un monto sin día atribuible va a «Por repartir».
- Fechas: días civiles de Chile `YYYY-MM-DD`. Hoy = `todayInChile()`, año de código = `codeYear()`, día anterior = `addDaysToPlainDate(d, -1)` (todo en `@/lib/utils`).
- `valid_to` es **inclusivo**. Al cerrar por una asignación nueva: `valid_to = addDaysToPlainDate(nuevoValidFrom, -1)`.
- Contrato creado desde la faena: `billing_cycle = 'none'`, `currency = 'CLP'`, `status = 'active'`, `code = nextCodeTx(tx, "CTR", codeYear())` → `CTR-AAAA-NNNN`.
- Permisos (no se crean nuevos): contratos y mandantes `admin:worksites`; asignar equipos `mant:equipment:manage`.
- Definiciones de costo, idénticas al Panel:
  - combustible: `fuel_provider_transactions.amount`, con día `left(occurred_at,10)` y `accountableProviderTransactionsWhere()`;
  - compras: `purchase_order_items.subtotal` de líneas no `cancelled`, con `issuedOrderPredicate()` y día `left(purchase_orders.issued_at,10)`;
  - OT: `mant_work_orders.total_cost` con `status='cerrada'`, día de `closed_at` en `America/Santiago`.
- Permisos de cifras como hoy:
  - combustible: `combustibles:view` + `combustibles:view_costs`;
  - compras: `sessionCanViewPurchaseCosts(session)`;
  - OT: `sessionCanViewWorkOrders(session)` → `workOrderMetricsScope(session)`.
- Textos fijos: «Costo por contrato», «Sin contrato», «Por repartir», «Compras sin equipo», «Nuevo contrato», «Asignar equipos», «Cambiar contrato», «parcial», «Vigente» / «Suspendido» / «Cerrado».
- UI según AGENTS.md:
  - `PageHeader` + `PageContainer`;
  - `DatePicker` (nunca `<input type="date">`);
  - estados con `Badge` en español;
  - `EmptyState` con CTA;
  - `VehicleIdentity` para equipos;
  - filtros con `router.replace(url, { scroll: false })`;
  - exportación sólo Excel.
- Migraciones: sólo `npm run db:generate`; nunca editar `_journal.json` ni un `.sql` ya generado; registrar checksums.
- Todo test PGlite nuevo se agrega a `tests/pglite-files.ts`. Se corre con `npm run test:pglite -- <ruta>`; los demás con `npm run test:fast -- <ruta>`.
- Commits: `git commit -- <rutas>` (el índice puede tener cambios de otra sesión). Mensajes terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Asignación con fecha anterior a una existente.** Ej.: el equipo tiene una asignación desde 2026-06-01 y se intenta asignar desde 2026-03-01. Debe rechazarse nombrando el código del equipo, nunca dejar intervalos traslapados. → Tarea 3, test «rechaza una fecha anterior a una asignación existente».
2. **Equipo movido de faena por la importación XLSX del padrón de combustible.** Debe cerrar su contrato igual que el traslado desde Mantención. → Tarea 4, test estático de llamadores + test PGlite del envoltorio.
3. **Período del Panel que no empieza el día 1.** El agregado mensual (fechado el día 1) queda fuera igual que en el Panel. El reparto debe dar exactamente lo mismo que el resumen por equipo. → Tarea 6, tests de igualdad con período `2026-03-15..2026-04-20`.
4. **Usuario sin `combustibles:view_costs`.** Ve los contratos con «—» en combustible y el total marcado «parcial», nunca `$0`. → Tarea 7, test «sin combustibles:view_costs la columna de combustible es null y el total sale parcial».
5. **Contrato editado en Facturación a otra faena con equipos asignados.** Debe rechazarse con un mensaje, no dejar equipos colgando de un contrato de otra faena. → Tarea 5, test «Facturación no puede mover de faena un contrato con equipos».

---

### Task 1: Esquema, migración y serie de códigos

**Files:**
- Create: `db/schema/contract-assignments.ts`
- Modify: `db/schema/index.ts` (export), `db/schema/clients.ts` (`worksiteId` → `onDelete: "restrict"`), `lib/code-sequences.ts` (`CODE_SERIES_TABLES`: `CTR: "contracts"`)
- Generated: `db/migrations/NNNN_*.sql`, `db/migrations/meta/*` (`_journal.json`, snapshot, `_sql-checksums.json`)
- Test: `lib/__tests__/contract-assignments-schema-pglite.test.ts` (+ `tests/pglite-files.ts`)

**Interfaces:**
- Produces: `contractVehicleAssignments` (Drizzle table) with columns:
  - `id` text PK;
  - `contractId` → `contracts.id` (`restrict`);
  - `vehicleId` → `fuel_vehicles.id` (`restrict`);
  - `validFrom` text not null;
  - `validTo` text null;
  - `reason` text null;
  - `createdByUserId` → `users.id` (`set null`);
  - `createdAt`, `updatedAt` (timestamptz string).
- Checks and indexes:
  - `contract_vehicle_assignments_dates_valid` (`valid_to IS NULL OR valid_to >= valid_from`);
  - both dates match `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`;
  - unique `contract_vehicle_assignments_open_unique` on `(vehicle_id) WHERE valid_to IS NULL`;
  - index on `(vehicle_id, valid_from)`;
  - index on `(contract_id, valid_from)`.
- Relations: `contract` and `vehicle` (one). No `many` is added on `contracts` (avoids the circular import with `clients.ts`).

- [ ] **Step 1: Write the failing test** — Setup as in `lib/combustibles/__tests__/provider-mappings.test.ts` (PGlite + `migratePGlite`). Seed: one worksite, one vehicle, one client and one contract.
  - `rechaza valid_to anterior a valid_from`: inserting `{validFrom:"2026-03-10", validTo:"2026-03-09"}` rejects with `/contract_vehicle_assignments_dates_valid/`.
  - `admite valid_to igual a valid_from`: `{validFrom:"2026-03-10", validTo:"2026-03-10"}` resolves.
  - `admite una sola asignación abierta por equipo`: a second insert with `validTo: null` for the same vehicle rejects with `/contract_vehicle_assignments_open_unique/`.
  - `no deja borrar una faena con contratos`: `delete(worksites)` of the contract's worksite rejects (FK).
  - `emite códigos CTR por año`: `await nextCodeTx(testDb, "CTR", 2026)` returns `"CTR-2026-0001"`, then `"CTR-2026-0002"`.
- [ ] **Step 2: Run it** — `npm run test:pglite -- lib/__tests__/contract-assignments-schema-pglite.test.ts`. Expected: FAIL (table does not exist).
- [ ] **Step 3: Write the schema** as in the Interfaces block, with the doc comment from spec § 6.2.
- [ ] **Step 4: Generate the migration**
  - Run `npm run db:generate`.
  - Check that the `.sql` has the `CREATE TABLE` and the `DROP CONSTRAINT` / `ADD CONSTRAINT … ON DELETE restrict` of `contracts_worksite_id_worksites_id_fk`.
  - If the `feat/ot-sin-costo` branch was merged first, the number will be the next one; never renumber by hand.
- [ ] **Step 5: Apply and close the chain**
  - `PGHOST=/var/run/postgresql npm run db:migrate` against `bodega_dev`.
  - `npm run db:generate` → "No schema changes".
  - `node scripts/verify-migration-chain.mjs --update-checksums`.
  - `npm run db:verify-migrations` → OK.
- [ ] **Step 6: Run the test** — same command. Expected: PASS. Also `npm run test:fast -- db/schema-consistency.test.ts` → PASS.
- [ ] **Step 7: Commit** `feat(contratos): tabla de asignaciones equipo → contrato y serie CTR`.

### Task 2: Atribución pura de costos

**Files:**
- Create: `lib/contracts/cost-attribution.ts`
- Test: `lib/contracts/__tests__/cost-attribution.test.ts`

**Interfaces:**
- Produces (pure, no imports from `@/db`):
```ts
export type CostComponent = "fuel" | "workOrders" | "purchases"
export interface DatedCost { vehicleId: string; day: string; amount: number; component: CostComponent; spansMonth: boolean }
export interface AssignmentWindow { vehicleId: string; contractId: string; worksiteId: string; validFrom: string; validTo: string | null }
export type ComponentSums = Record<CostComponent, number>
export interface WorksiteAttribution { contracts: Map<string, ComponentSums>; unassigned: ComponentSums; pending: ComponentSums }
export function emptySums(): ComponentSums
export function attributeCosts(input: {
  costs: readonly DatedCost[]
  assignments: readonly AssignmentWindow[]
  vehicleWorksite: ReadonlyMap<string, string>   // faena ACTUAL de cada equipo
}): Map<string, WorksiteAttribution>             // clave: worksiteId
```
- Rules:
  - **Daily cost** (`spansMonth:false`): if a window covers `day` (`validFrom <= day && (validTo === null || day <= validTo)`), it goes to that contract under `window.worksiteId`. Otherwise it goes to `unassigned` under `vehicleWorksite.get(vehicleId)`.
  - **Monthly cost** (`spansMonth:true`): month = `[day.slice(0,7)-01, last day of the month]`.
    - No window overlaps the month → `unassigned` of the current worksite.
    - Exactly one window, and it covers the whole month → that contract.
    - Any other case → `pending`, under the worksite shared by the overlapping windows, or the current worksite if they differ.
  - A vehicle missing from `vehicleWorksite` → `throw new Error(\`Equipo sin faena: ${vehicleId}\`)`.

- [ ] **Step 1: Write the failing tests** (Vitest, deterministic inputs, cents-free amounts):
  - `atribuye una carga diaria al contrato vigente ese día`
  - `una carga sin asignación ese día va a Sin contrato de la faena actual`
  - `valid_to es inclusivo`: `day === validTo` → contract.
  - `un agregado mensual con un solo contrato todo el mes va a ese contrato`
  - `un agregado mensual con cambio de contrato a mitad de mes va a Por repartir`
  - `un agregado mensual con contrato sólo desde el día 10 va a Por repartir`
  - `un costo de febrero va al contrato de febrero aunque el equipo hoy esté en otra faena`: window `worksiteId:"w-a"`, `vehicleWorksite` → `"w-b"`. Expect the amount under `w-a`, and `w-b` absent or zero.
  - `la suma de todas las cubetas es igual a la suma de los costos`: a mixed input of 6 costs across 3 components; Σ per component across all worksites/buckets === Σ input per component.
  - `rechaza un equipo sin faena`
- [ ] **Step 2: Run** `npm run test:fast -- lib/contracts/__tests__/cost-attribution.test.ts` → FAIL.
- [ ] **Step 3: Implement** `attributeCosts` following the rules above. Index the windows by `vehicleId` once (no `filter` per cost).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(contratos): atribución de costos por día y agregados mensuales`.

### Task 3: Servicio de asignaciones

**Files:**
- Create: `lib/services/contracts/assignments.ts`, `lib/validation/contracts.ts`
- Test: `lib/__tests__/contract-assignments-pglite.test.ts` (+ `tests/pglite-files.ts`)

**Interfaces:**
- Consumes: `contractVehicleAssignments` (T1), `AssignmentWindow` (T2).
- Produces:
```ts
// lib/validation/contracts.ts
export const contractAssignmentSchema   // { contractId: string; vehicleIds: string[] (min 1, max 200); validFrom: YYYY-MM-DD; reason?: string ≤ 300 }
export const endAssignmentSchema        // { vehicleId: string; lastDay: YYYY-MM-DD; reason?: string ≤ 300 }
// lib/services/contracts/assignments.ts  (sin chequeo de permisos: lo hacen las actions)
export interface AssignmentActor { userId: string; email?: string | null }
export type AssignmentResult = { ok: true; assigned: number; warnings: string[] } | { ok: false; message: string }
export async function assignVehiclesToContract(actor: AssignmentActor, input: unknown, client?: DB): Promise<AssignmentResult>
export async function endVehicleAssignment(actor: AssignmentActor, input: unknown, client?: DB): Promise<{ ok: true } | { ok: false; message: string }>
export async function closeContractAssignmentsOnRelocationTx(tx: Tx, input: { vehicleId: string; effectiveFrom: string; actorUserId: string; actorEmail?: string | null }): Promise<number>
export async function assertContractChangeKeepsAssignmentsTx(tx: Tx, contractId: string, next: { worksiteId: string | null; startDate: string | null; endDate: string | null; status: "active" | "suspended" | "closed" }): Promise<string | null>  // null = permitido; string = mensaje
export async function listAssignmentWindows(vehicleIds: readonly string[], from: string, to: string, client?: DB): Promise<AssignmentWindow[]>  // ventanas que tocan [mes de `from`, `to`]
export interface VehicleAssignmentRow { id: string; contractId: string; contractName: string; contractCode: string; validFrom: string; validTo: string | null; reason: string | null }
export async function listVehicleAssignmentHistory(vehicleId: string, client?: DB): Promise<VehicleAssignmentRow[]>  // más reciente primero
```
- Rules for `assignVehiclesToContract`, in one `db.transaction`:
  1. Lock the contract `.for("update")`. It must exist, be `active`, have `worksiteId`, and satisfy `startDate <= validFrom <= endDate` when those are set.
  2. Lock the vehicles with `.for("update")`, ordered by `id`. All must be active and belong to `contract.worksiteId`.
  3. For each vehicle:
     - an assignment with `validFrom > input.validFrom`, or a closed one covering `input.validFrom` → reject the whole batch: `"${code} ya tiene una asignación desde ${fecha}; corrígela desde su ficha"`;
     - an open one to the same contract → skip (not counted);
     - an open one with the same `validFrom` → update `contractId` (correction);
     - an earlier open one → close it with `validTo = addDaysToPlainDate(validFrom, -1)`.
  4. Insert the new one with `validTo = contract.endDate ?? null`.
  5. `recordAudit({ action: "create", entityType: "contract_vehicle_assignment", entityId, worksiteId, newState }, tx)`.
- Warning: if `fuel_provider_mappings` place the vehicle in another worksite at some point of `[validFrom, todayInChile()]`, add `"${code}: el mapeo de combustible lo ubica en otra faena entre ${desde} y ${hasta}"`.
- `closeContractAssignmentsOnRelocationTx`:
  - closes the open one with `validTo = addDaysToPlainDate(effectiveFrom, -1)`;
  - deletes the ones with `validFrom >= effectiveFrom`;
  - audits each change;
  - returns how many it touched.
- `assertContractChangeKeepsAssignmentsTx` rejects the change when assignments exist and any of these holds:
  - the worksite changes;
  - `startDate` moves after the first `validFrom`;
  - `endDate` falls before the last day covered (an open one counts as unbounded);
  - `status` moves to `closed`/`suspended` while assignments are still open.

- [ ] **Step 1: Write the failing tests** (seed: worksites `w-a`/`w-b`; contracts `c-1`/`c-2` in `w-a`, `c-3` in `w-b`; vehicles `v-1`/`v-2` in `w-a`, `v-3` in `w-b`):
  - `asigna varios equipos desde una fecha y deja una asignación abierta por equipo`
  - `al reasignar cierra la anterior el día previo`: c-1 from 03-01, then c-2 from 06-15 → c-1 `validTo === "2026-06-14"`.
  - `reasignar el mismo día corrige el contrato en vez de cerrar`
  - `asignar al mismo contrato vigente no hace nada`: `assigned === 0`.
  - `rechaza una fecha anterior a una asignación existente`: `message` contains the vehicle code and no row changes.
  - `rechaza equipos de otra faena`
  - `rechaza contratos suspendidos o cerrados y fechas fuera del contrato`
  - `una asignación a un contrato con término hereda ese término`
  - `avisa cuando el mapeo de combustible ubica al equipo en otra faena`
  - `quitar del contrato cierra la asignación en el último día indicado`
  - `closeContractAssignmentsOnRelocationTx cierra la abierta el día anterior y borra las que empiezan después`
  - `assertContractChangeKeepsAssignmentsTx bloquea cambiar faena, retrasar inicio, adelantar término o cerrar con asignaciones abiertas`: 4 cases, each returns a string; with no assignments, returns `null`.
  - `audita cada asignación`: one `audit_log` row per vehicle with `entity_type = 'contract_vehicle_assignment'`.
- [ ] **Step 2: Run** `npm run test:pglite -- lib/__tests__/contract-assignments-pglite.test.ts` → FAIL.
- [ ] **Step 3: Implement** the schemas and the service following the rules.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(contratos): asignar, cerrar y validar asignaciones de equipos`.

### Task 4: El traslado de faena cierra el contrato

**Files:**
- Create: `lib/services/fleet-relocation.ts`
- Modify (replace the direct call to `moveProviderMappingsWithVehicleTx`):
  - `app/(app)/combustibles/actions-module/vehicles.ts` (~l.323 `updateFuelVehicleAction`, ~l.593 `importFuelVehiclesFromXlsx`);
  - `lib/services/mantencion/equipment.ts` (~l.123 `applyCreate`, ~l.253 `applyUpdate`).
- Test:
  - `lib/__tests__/fleet-relocation-pglite.test.ts` (+ `tests/pglite-files.ts`);
  - `lib/__tests__/fleet-relocation-callers.test.ts` (static, `test:fast`);
  - one case added to `lib/__tests__/mantencion-equipment-pglite.test.ts`.

**Interfaces:**
- Consumes: `moveProviderMappingsWithVehicleTx` (`lib/combustibles/provider-mappings.ts`), `closeContractAssignmentsOnRelocationTx` (T3).
- Produces:
```ts
export async function relocateVehicleWorksiteTx(tx: Tx, input: { vehicleId: string; worksiteId: string; actorUserId: string; actorEmail?: string | null; effectiveFrom?: string }): Promise<{ movedMappings: number; closedAssignments: number }>
```
  It calls both functions with `effectiveFrom ?? todayInChile()`.

- [ ] **Step 1: Write the failing tests**
  - Static: `ningún archivo fuera de fleet-relocation llama a moveProviderMappingsWithVehicleTx`. Scan `app/` and `lib/` (`fs` + glob, excluding tests and `lib/combustibles/provider-mappings.ts`), like `components/__tests__/modal-alto-estable.test.ts`.
  - PGlite: `trasladar cierra el contrato y mueve los mapeos el mismo día`.
  - In `mantencion-equipment-pglite.test.ts`: `mover un equipo de faena por importación cierra su asignación de contrato`.
- [ ] **Step 2: Run** both commands → FAIL.
- [ ] **Step 3: Implement** the wrapper and replace the 4 calls, keeping the same arguments.
- [ ] **Step 4: Run** the 3 tests and the existing `npm run test:pglite -- lib/combustibles/__tests__/provider-mappings.test.ts lib/__tests__/mantencion-equipment-pglite.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(contratos): el traslado de faena cierra la asignación de contrato`.

### Task 5: Contratos desde la faena, mandantes y ajuste de Facturación

**Files:**
- Create: `lib/services/contracts/contracts.ts`, `components/contracts/contract-core-fields.tsx`
- Modify:
  - `lib/validation/contracts.ts` (schemas);
  - `app/(app)/facturacion/actions.ts` (`saveContractAction`: `code` optional + guard);
  - `app/(app)/facturacion/clientes/client-contract-manager.tsx` (use `ContractCoreFields`; `code` not required, with helper «Se genera solo si lo dejas vacío»).
- Test: `lib/__tests__/contracts-operational-pglite.test.ts` (+ `tests/pglite-files.ts`)

**Interfaces:**
- Consumes: `assertContractChangeKeepsAssignmentsTx`, `AssignmentActor` (T3); `nextCodeTx` (`lib/code-sequences.ts`); `cleanRut`/`validateRut` (`lib/rut`); `contractHasBillingHistory` (`lib/services/billing/client-identity.ts`).
- Produces:
```ts
// lib/validation/contracts.ts
export const operationalContractSchema  // { id?; worksiteId; clientId; name (2–120, trim); startDate?: YYYY-MM-DD; endDate?: YYYY-MM-DD; status: "active"|"suspended"|"closed" } + refine startDate <= endDate
export const mandanteSchema             // { rut; name (2–160, trim) }
// lib/services/contracts/contracts.ts
export type ContractWriteResult = { ok: true; id: string; code: string } | { ok: false; message: string; fieldErrors?: Record<string, string[]> }
export async function nextContractCodeTx(client: Tx | DB): Promise<string>
export async function saveOperationalContract(actor: AssignmentActor, input: unknown, client?: DB): Promise<ContractWriteResult>
export async function createMandante(actor: AssignmentActor, input: unknown, client?: DB): Promise<{ ok: true; id: string; existed: boolean } | { ok: false; message: string }>
export interface MandanteOptions { clients: { id: string; rut: string; name: string }[]; suggestions: { rut: string; name: string }[] }
export async function listMandanteOptions(client?: DB): Promise<MandanteOptions>
// components/contracts/contract-core-fields.tsx ("use client")
export function ContractCoreFields(props: { clients: { id: string; name: string }[]; defaults?: { name?: string; clientId?: string; startDate?: string | null; endDate?: string | null }; errors?: Record<string, string[] | undefined>; clientSlot?: React.ReactNode }): JSX.Element
// Campos: «Nombre del contrato», «Mandante» (OptionSelect, o `clientSlot` si viene), «Desde», «Hasta» (DatePicker / ClearableDatePicker); nombres de input: name, clientId, startDate, endDate.
```
- `saveOperationalContract`:
  - **On create:** it sets the defaults from Global Constraints and never writes billing fields.
  - **On update:** it changes only `name`, `clientId`, `startDate`, `endDate` and `status`.
    - It rejects changing `clientId` if `contractHasBillingHistory`.
    - It calls `assertContractChangeKeepsAssignmentsTx`.
  - It audits with `entityType:"contract"`, `entityId: id`, `worksiteId`.
- `createMandante`:
  - an invalid RUT → `{ok:false}`;
  - an existing RUT → `{ok:true, existed:true}` with that client's id.
- `listMandanteOptions().suggestions`:
  - takes distinct `receiver_tax_id`/`receiver_name` from `billing_invoices`, with `direction = 'sale'`;
  - normalizes with `cleanRut` and excludes RUTs already in `clients`;
  - keeps the 20 most frequent.
- `saveContractAction` (Facturación):
  - **On create:** an empty `code` → `nextContractCodeTx` inside a transaction.
  - **On update:** it calls `assertContractChangeKeepsAssignmentsTx` inside its existing transaction, and returns its message if not null.

- [ ] **Step 1: Write the failing tests**
  - `crea un contrato de faena con código CTR del año y ciclo Sin calendario`: `code` matches `/^CTR-2026-\d{4}$/`, `billingCycle === "none"`.
  - `no cambia los campos de cobro al editar desde la faena`: first set `periodAmount=1000` and `billingCycle="monthly"` directly in the DB, then edit the name; both stay.
  - `rechaza cambiar la faena de un contrato con equipos asignados`
  - `crear mandante con un RUT existente devuelve el cliente existente`
  - `rechaza un RUT inválido`
  - `las sugerencias de mandante salen de los receptores de facturas de venta sin cliente`
  - `Facturación genera el código si viene vacío`: call `saveContractAction` with `vi.mock("@/lib/auth/can")` so that `guardPermission` returns a session with `billing:manage_clients`, plus `vi.mock("next/cache")`.
  - `Facturación no puede mover de faena un contrato con equipos`
- [ ] **Step 2: Run** `npm run test:pglite -- lib/__tests__/contracts-operational-pglite.test.ts` → FAIL.
- [ ] **Step 3: Implement** the service, the schemas, `ContractCoreFields` and the Facturación changes.
- [ ] **Step 4: Run** the new test + `npm run test:fast -- lib/__tests__/facturacion-clientes-identidad.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(contratos): contratos desde la faena, mandantes y código automático`.

### Task 6: Partidas de costo por día con la misma definición del Panel

**Files:**
- Modify:
  - `lib/combustibles/control/queries/asset-fuel-summary.ts` (extract a private helper with the `WHERE` of the billed amount; use it in `getAssetFuelSummary` and in the new function);
  - `lib/services/purchasing-module/vehicle-purchase-summary.ts` (same with its conditions);
  - `lib/services/mantencion/work-orders/metrics.ts` (same with the `closedInRange` filter).
- Test (extend):
  - `lib/__tests__/operational-control-fuel-pglite.test.ts`;
  - `lib/__tests__/operational-control-purchases-pglite.test.ts`;
  - `lib/__tests__/mantencion-work-orders-metrics-pglite.test.ts`.

**Interfaces:**
- Consumes: `DatedCost` (T2).
- Produces:
```ts
export async function getFuelBilledByVehicleDay(session: Session, period: { from: string; to: string }, vehicleIds: readonly string[]): Promise<DatedCost[]>
  // component "fuel"; spansMonth = granularity === "period_aggregate"; [] sin combustibles:view_costs
export async function getVehiclePurchaseByDay(session: Session, period: { from: string; to: string }, vehicleIds: readonly string[]): Promise<DatedCost[]>
  // component "purchases"; [] sin purchasing:view
export async function getWorksitePurchasesWithoutVehicle(session: Session, period: { from: string; to: string }): Promise<Map<string, number>>
  // líneas sin request item o con request item sin vehicle_id; agrupado por purchase_orders.worksite_id; alcance de la OC
export async function getWorkOrderCostByVehicleDay(scope: WorkOrderMetricsScope, options: { period: WorkOrderPeriod }): Promise<DatedCost[]>
  // component "workOrders"; día = to_char((closed_at AT TIME ZONE 'America/Santiago')::date,'YYYY-MM-DD'); sólo total_cost no nulo
```
  Each function groups by vehicle and day in a single query (never one per vehicle).

- [ ] **Step 1: Write the failing tests** (use `MID = { from: "2026-03-15", to: "2026-04-20" }` besides the existing periods; add a `period_aggregate` on 2026-04-01 and another on 2026-03-01):
  - fuel: `el detalle por día suma lo mismo que el resumen por equipo`, for `MARCH` and `MID`.
  - fuel: `marca los agregados mensuales como spansMonth`
  - purchases: `el detalle por día de compras suma lo mismo que el resumen`, for `MARCH` and `MID`.
  - purchases: `las compras sin equipo se agrupan por la faena de la OC y excluyen líneas anuladas`
  - OT: `el costo de OT por día suma lo mismo que maintenanceCostInPeriod`
- [ ] **Step 2: Run** the 3 files with `npm run test:pglite -- …` → FAIL.
- [ ] **Step 3: Implement**, sharing the conditions with the existing function (do not copy them).
- [ ] **Step 4: Run** the 3 complete files (old and new cases) → PASS.
- [ ] **Step 5: Commit** `feat(contratos): partidas de costo por día con la definición del Panel`.

### Task 7: Costo por contrato

**Files:**
- Create: `lib/services/contracts/contract-costs.ts`
- Test: `lib/__tests__/contract-costs-pglite.test.ts` (+ `tests/pglite-files.ts`)

**Interfaces:**
- Consumes: T2 (`attributeCosts`), T3 (`listAssignmentWindows`), T6 (four functions), `workOrderMetricsScope`, `sessionCanViewWorkOrders`, `sessionCanViewPurchaseCosts`, `resolveWorksiteScope`.
- Produces:
```ts
export interface ContractCostRow {
  kind: "contract" | "unassigned" | "pending" | "no_equipment"
  contractId: string | null; label: string; clientName: string | null
  status: "active" | "suspended" | "closed" | null
  vehicleCount: number
  fuel: number | null; workOrders: number | null; purchases: number | null
  total: number | null; partial: boolean
}
export interface WorksiteContractCosts { worksiteId: string; worksiteName: string; rows: ContractCostRow[]; total: number | null; partial: boolean }
export interface ContractCostBreakdown {
  worksites: WorksiteContractCosts[]
  availability: Record<CostComponent, boolean>
  contractOptions: { id: string; label: string }[]   // «Faena · Contrato», orden faena/contrato
  windows: AssignmentWindow[]                         // para filtrar activos por contrato
}
export async function getContractCostBreakdown(session: Session, period: OperationalControlPeriod, vehicles: readonly { id: string; worksiteId: string }[]): Promise<ContractCostBreakdown>
export function contractVehicleIds(windows: readonly AssignmentWindow[], contractId: string, period: OperationalControlPeriod): Set<string>
```
- Availability of each component:
  - `fuel = can(view) && can(view_costs)`;
  - `workOrders = sessionCanViewWorkOrders`;
  - `purchases = sessionCanViewPurchaseCosts`.
  - If a query throws, that component is `false` and is logged with `logger.warn`, as the hub's `settleAttention` does.
- Unavailable component: its value is `null` in every row, `total` = sum of the available ones and `partial = true`.
- Worksites shown: only the ones within scope that have ≥1 contract.
- Rows of each worksite:
  - contracts that are `active` or have a window in the period, ordered by name;
  - then «Sin contrato», «Por repartir» and «Compras sin equipo», only if non-zero.
  - The `no_equipment` row carries only `purchases`.
- `vehicleCount` = distinct vehicles with a window in the period.

- [ ] **Step 1: Write the failing tests** (`seedControlFixtures` + 2 contracts, back-dated assignments, a period aggregate with a mid-month contract change):
  - `reparte el costo del Panel entre contratos, Sin contrato y Por repartir sin perder ni duplicar`. Global session with all permissions. For each component: Σ rows (excluding `no_equipment`) across all worksites === Σ of the matching `getOperationalControlHub` field (`fuelBilledAmount`, `maintenanceCost`, `purchaseAmount`) over the assets with `kind === "vehicle"`.
  - `omite faenas sin contratos`
  - `sin combustibles:view_costs la columna de combustible es null y el total sale parcial`
  - `un usuario acotado no ve contratos de faenas fuera de su alcance`
  - `muestra Compras sin equipo con las OC de la faena sin equipo`
  - `contractVehicleIds devuelve los equipos con ventana del contrato en el período`
- [ ] **Step 2: Run** `npm run test:pglite -- lib/__tests__/contract-costs-pglite.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(contratos): costo por contrato con cuadratura contra el Panel`.

### Task 8: Detalle de faena `/admin/faenas/[id]`

**Files:**
- Create:
  - `lib/services/contracts/worksite-view.ts`;
  - `app/(app)/admin/faenas/[id]/layout.tsx`, `page.tsx`, `loading.tsx`, `contract-actions.ts`;
  - `worksite-contracts-view.tsx`, `contract-sheet.tsx`, `assign-vehicles-sheet.tsx` (same folder).
- Modify:
  - `app/(app)/admin/faenas/faenas-list.tsx` + `page.tsx` (link to the detail and «N contratos» under the name, on desktop and mobile; do not touch `catalog-contract.ts`);
  - `components/layout/top-bar.tsx` (`OWN_SEARCH_PATTERNS` += `/^\/admin\/faenas\/[^/]+$/`, with a comment);
  - `scripts/capture-all-routes.ts` (`{ slug: "admin-faenas-detalle", path: "/admin/faenas/ws-audit-1", auth: true, notes: "Contratos y equipos de la faena" }`).
- Test:
  - `app/(app)/admin/faenas/[id]/worksite-contracts-view.test.tsx`;
  - `app/(app)/admin/faenas/[id]/page.test.tsx`;
  - `components/layout/top-bar-own-search.test.ts` (new case);
  - `scripts/capture-all-routes.test.ts` (must keep passing).

**Interfaces:**
- Consumes: T3, T5, `ActionState` (`lib/validation/masters.ts`), `revalidateVehicleFicha`.
- Produces:
```ts
// worksite-view.ts
export interface WorksiteContractView {
  worksite: { id: string; name: string; code: string }
  contracts: { id: string; code: string; name: string; clientId: string; clientName: string; startDate: string | null; endDate: string | null; status: "active" | "suspended" | "closed"; vehicles: { id: string; code: string | null; plate: string | null; typeName: string; validFrom: string }[] }[]
  unassignedVehicles: { id: string; code: string | null; plate: string | null; typeName: string }[]
  assignableVehicles: { id: string; code: string | null; plate: string | null; typeName: string; currentContractName: string | null }[]
}
export async function getWorksiteContractView(worksiteId: string, today?: string): Promise<WorksiteContractView | null>
export async function countContractsByWorksite(worksiteIds: readonly string[]): Promise<Map<string, number>>
// contract-actions.ts ("use server")
export async function saveOperationalContractAction(input: unknown): Promise<ActionState>   // guardPermission("admin:worksites") + canAccessWorksite
export async function createMandanteAction(input: unknown): Promise<ActionState>            // guardPermission("admin:worksites"); data: { id }
export async function assignVehiclesAction(input: unknown): Promise<ActionState>            // guardPermission("mant:equipment:manage") + canAccessWorksite(contrato); data: { warnings }
```
- Each action ends with:
  - `revalidatePath(\`/admin/faenas/${worksiteId}\`)`;
  - `revalidatePath("/control-operacional")`;
  - `revalidateVehicleFicha(id)` for each affected vehicle.
- **Page.** Copy the guard and layout from `app/(app)/admin/equipos/[id]/page.tsx`: `requirePermission("admin:worksites")` → `redirect("/forbidden")`; out of scope → `notFound()`.
  - `PageContainer width="workbench"`.
  - `PageHeader`:
    - `title` = worksite name;
    - `description` = `${code} · ${n} equipos · ${m} contratos`;
    - breadcrumb Inicio > Administración > Faenas > name;
    - `actions` = «Nuevo contrato».
  - Active contracts as cards (name, mandante, «Vigente desde …», badge, «Editar», «Asignar equipos», `VehicleIdentity` + «desde dd-mm-aaaa» list).
  - Suspended and closed ones inside `<details>` «Contratos cerrados (N)».
  - «Sin contrato» card at the end.
  - Empty state: `EmptyState` with
    - title «Esta faena no tiene contratos»;
    - description «Crea un contrato por cada servicio que se presta aquí para separar sus equipos y costos.»;
    - action «Nuevo contrato».
- **Contract sheet.** `ContractCoreFields` with `clientSlot`: a `Combobox` of clients plus suggestions. Picking a suggestion, or «Crear mandante» (RUT + razón social), calls `createMandanteAction` before saving.
- **Assign sheet.** Checkboxes of `assignableVehicles` (showing the current contract) + `DatePicker` «Desde» (default today) + optional reason. Warnings are shown with `toast.warning`.

- [ ] **Step 1: Write the failing tests** (jsdom; mocks for `next/navigation` and the actions, as in `app/(app)/flota/[id]/vehicle-expiries.test.tsx`):
  - `muestra cada contrato con su mandante y equipos, y los equipos sin contrato aparte`
  - `sin contratos muestra el estado vacío con «Nuevo contrato»`
  - `oculta «Asignar equipos» sin permiso de equipos`
  - `envía los equipos marcados y la fecha desde`: `assignVehiclesAction` is called with `{ contractId, vehicleIds:["v-1","v-2"], validFrom:"2026-11-18" }`.
  - page: `redirige a /forbidden sin admin:worksites` and `404 fuera del alcance de faena` (pattern from `app/(app)/flota/[id]/ficha.test.tsx`).
  - top-bar: `oculta la búsqueda de la shell en el detalle de una faena`.
- [ ] **Step 2: Run** `npm run test:fast -- "app/(app)/admin/faenas" components/layout/top-bar-own-search.test.ts scripts/capture-all-routes.test.ts` → FAIL.
- [ ] **Step 3: Implement** the service, actions, page and components.
- [ ] **Step 4: Run** the same command + `npm run test:fast -- components/admin/catalog-contract.test.ts components/__tests__/modal-alto-estable.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(contratos): detalle de faena con contratos y asignación de equipos`.

### Task 9: Contrato en la ficha del equipo

**Files:**
- Modify:
  - `lib/services/vehicle-ficha.ts` (`VehicleFichaVehicle.contractName: string | null`, from the window covering `todayInChile()`, inside `loadFichaVehicle`);
  - `app/(app)/flota/[id]/_ficha/ficha-chrome.tsx` (`vehicleFichaDescription`: `[typeName, plate, worksiteName, contractName, state]`, omitting null);
  - `app/(app)/flota/[id]/flota/page.tsx` (load the history and the contracts of the worksite);
  - `app/(app)/flota/actions.ts` (new action).
- Create: `app/(app)/flota/[id]/flota/vehicle-contract-card.tsx`, `app/(app)/flota/[id]/flota/change-contract-sheet.tsx`
- Test: `app/(app)/flota/[id]/flota/vehicle-contract-card.test.tsx`, `app/(app)/flota/[id]/ficha.test.tsx` (case), `lib/__tests__/flota-change-contract-action.test.ts`

**Interfaces:**
- Consumes: `listVehicleAssignmentHistory`, `assignVehiclesToContract`, `endVehicleAssignment` (T3).
- Produces:
```ts
export async function changeVehicleContractAction(_prev: ActionState, formData: FormData): Promise<ActionState>
  // campos: vehicleId, contractId ("" = Sin contrato), validFrom; guardPermission("mant:equipment:manage") + canAccessWorksite(faena del equipo)
  // contractId → assignVehiclesToContract([vehicleId]); "" → endVehicleAssignment(lastDay = addDaysToPlainDate(validFrom, -1))
  // revalidateVehicleFicha(vehicleId) + revalidatePath("/control-operacional")
```
- Card «Contrato» in the Flota tab, next to «Historial de estado operacional», with the same `ol.divide-y` pattern:
  - current contract or «Sin contrato»;
  - history (name, from–to);
  - «Cambiar contrato» button only with `mant:equipment:manage`.
- The sheet offers the worksite's active contracts + «Sin contrato» and a `DatePicker` «Desde».

- [ ] **Step 1: Write the failing tests**:
  - `muestra el contrato vigente y el historial`
  - `sin permiso no muestra «Cambiar contrato»`
  - `elegir «Sin contrato» envía contractId vacío`
  - ficha: `la descripción incluye el contrato después de la faena`
  - action (mocks of `can`, `scope` and the service): `exige mant:equipment:manage y alcance de la faena`
- [ ] **Step 2: Run** `npm run test:fast -- "app/(app)/flota/[id]" lib/__tests__/flota-change-contract-action.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS (including the existing `vehicle-expiries.test.tsx` and `page.test.tsx`).
- [ ] **Step 5: Commit** `feat(contratos): contrato e historial en la ficha del equipo`.

### Task 10: «Costo por contrato» en el Panel operacional

**Files:**
- Modify:
  - `lib/services/operational-control.ts`: `OperationalAsset.contractId` / `contractName`, from the window covering `period.to`; `null` for service equipment.
  - `app/(app)/control-operacional/page.tsx`:
    - read `sp.contrato`;
    - after the hub, call `getContractCostBreakdown(session, period, vehiclesFromHubAssets)`;
    - filter `assets` with `contractVehicleIds` when there is a contract;
    - propagate `contrato` to the links that build `?desde=…&hasta=…` (l.~305) and to `OperationalExportButton`.
  - `operational-assets-table.tsx`: «Contrato» column after «Faena», in `COLUMNS`, `renderRow` and `renderMobileCard`.
  - `operational-export-button.tsx`, `actions.ts`, `lib/operational-control/export-columns.ts`.
- Create: `app/(app)/control-operacional/contract-cost-section.tsx`, `app/(app)/control-operacional/contract-filter.tsx`
- Test:
  - `app/(app)/control-operacional/contract-cost-section.test.tsx`;
  - `operational-assets-table.test.tsx` (case);
  - `lib/__tests__/operational-control-export-columns.test.ts` (case);
  - `lib/__tests__/operational-control-export-action.test.ts` (case).

**Interfaces:**
- Consumes: `ContractCostBreakdown`, `contractVehicleIds` (T7).
- Produces:
```ts
export function ContractCostSection(props: { breakdown: ContractCostBreakdown; period: OperationalControlPeriod; selectedContractId: string | null }): JSX.Element | null  // null si no hay faenas o ningún componente disponible
export function ContractFilter(props: { options: { id: string; label: string }[]; value: string | null }): JSX.Element  // OptionSelect «Todos los contratos»; router.replace(..., { scroll: false }) conservando desde/hasta
export async function exportOperationalControlXlsxAction(filters: Partial<OperationalControlPeriod> & { contrato?: string }): Promise<ExportActionResult>
```
- **Section.** Goes between «Desempeño del período» and `GpsCrossChecks`.
  - It is a `<section aria-labelledby="costo-por-contrato">` with a `Card`.
  - One table per worksite, using the primitives from `@/components/ui/table`, not `DataTable`.
  - Headers: «Contrato» · «Mandante» · «Equipos» · one column per available component («Combustible», «Mano de obra (OT)», «Compras») · «Total».
  - Worksite row with its subtotal; amounts with `formatCLP`; an unavailable value → «—».
  - A partial total gets a `Badge` «parcial».
  - The contract name is a `Link` with `scroll={false}` to `?desde&hasta&contrato=<id>`.
  - No KPI tiles (A1).
- **Filter.** Goes in the header of the «Vehículos y estado operacional» Card.
- **Excel:**
  - «Contrato» column (`key: "contractName"`, `width: 28`) after «Faena»;
  - new sheet «Costo por contrato» with columns Faena, Contrato, Mandante, Equipos, Combustible, Mano de obra (OT), Compras, Total, Parcial (Sí/No), `numFmt "$#,##0"` on the amounts;
  - with `contrato`, the «Activos» sheet is filtered the same as the screen.

- [ ] **Step 1: Write the failing tests**:
  - `agrupa por faena con subtotal y filas Sin contrato, Por repartir y Compras sin equipo`
  - `el nombre del contrato enlaza a ?contrato= conservando el período`
  - `marca «parcial» y muestra — cuando falta un componente`
  - `no se muestra sin faenas con contratos`
  - table: `muestra el contrato del equipo`
  - columns: `incluye la columna Contrato después de Faena`
  - export: `agrega la hoja «Costo por contrato» y filtra activos por contrato`
- [ ] **Step 2: Run** `npm run test:fast -- "app/(app)/control-operacional" lib/__tests__/operational-control-export-columns.test.ts lib/__tests__/operational-control-export-action.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command + `npm run test:pglite -- lib/__tests__/operational-control-purchases-pglite.test.ts lib/__tests__/operational-control-fuel-pglite.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(contratos): costo por contrato y filtro en el Panel operacional`.

### Task 11: Prueba E2E del recorrido

**Files:**
- Create: `e2e/contratos-faena.spec.ts`
- Read first: `e2e/admin-contenedores.spec.ts`, `e2e/ficha-vehiculo.spec.ts`, `e2e/helpers.ts` (section «Locators in this repository» of AGENTS.md).

**Interfaces:**
- Consumes: `ws-e2e` («Faena E2E»), `fuel-veh-e2e`, `admin@e2e.chome.cl` (seeded by `e2e/setup-db.ts`).

- [ ] **Step 1: Write the spec** `contratos de faena: crear, asignar y ver el costo`. Use `RUN = Date.now().toString(36).slice(-5).toUpperCase()`.
  1. `/admin/faenas` → `getByRole("link", { name: "Faena E2E", exact: true })` → `expectPageTitle(page, "Faena E2E")`.
  2. «Nuevo contrato» → name `QA_Residuos ${RUN}` → «Crear mandante» with RUT `76.123.456-0` and razón social `QA_Mandante E2E` → save.
  3. «Asignar equipos» on that contract → check `fuel-veh-e2e` → save → the card shows the vehicle (`textoVisible`).
  4. `/flota/fuel-veh-e2e` → the description contains `QA_Residuos ${RUN}`.
  5. `/control-operacional` → region «Costo por contrato» contains `getByRole("link", { name: \`QA_Residuos ${RUN}\`, exact: true })`.
- [ ] **Step 2: Run it in a disposable worktree**, because `test:e2e` deletes `.next`. Use `E2E_DATABASE_URL=… npm run test:e2e -- e2e/contratos-faena.spec.ts` → PASS. If `next build` aborts with `SecurityFatalError`, use `next dev` on :3100 with `reuseExistingServer`.
- [ ] **Step 3: Commit** `test(contratos): recorrido E2E de contratos de faena`.

### Task 12: Verificación final y QA en navegador

**Files:**
- Create: `qa/reports/2026-11-XX-contratos-por-faena.md` (actual date)

- [ ] **Step 1: Run the gates**, all → exit 0:
  - `npm run typecheck`;
  - `npm run lint`;
  - `npm run test:fast`;
  - `npm run test:pglite`;
  - `npm run db:verify-migrations`;
  - `npm run check:secrets`.
  - If `test:fast` has pre-existing failures on main, list them with evidence and separate them from the ones this work introduces.
- [ ] **Step 2: Seed QA data in `bodega_dev`** (already migrated in T1):
  - in «Cholguan - Arauco», create from the UI the contracts `QA_Movimiento de residuos` and `QA_Carga y descarga de madera`;
  - assign them some vehicles with `validFrom = 2026-08-01`;
  - leave one vehicle without a contract;
  - move one vehicle to another contract on 2026-10-15.
- [ ] **Step 3: Verify in the browser** (`next dev` :3002 on `bodega_dev`, Chromium from the repo):
  - faena detail, ficha of a reassigned vehicle and Panel for 2026-08-01..2026-10-31;
  - in the Panel, Σ of the section's rows (excluding «Compras sin equipo») per component = Σ of the matching asset columns;
  - filter by contract and Excel export;
  - mobile width (390 px);
  - no console errors and no failed requests.
- [ ] **Step 4: Write the QA report** with the format from AGENTS.md (PASS, findings, coverage gaps). Then delete the `QA_` data, or leave it documented in the report.
- [ ] **Step 5: Commit** the report.
