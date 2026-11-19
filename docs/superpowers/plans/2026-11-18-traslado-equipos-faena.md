# Traslado de equipos entre faenas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar traslados de uno o varios equipos entre faenas con fecha, motivo y autorización; guardar el recorrido por faena de cada equipo; que los reportes por faena cuenten cada día en la faena de ese día; y reconstruir el pasado hasta donde la evidencia lo permita.

**Architecture:** Una tabla de estadías (`fuel_vehicle_worksite_intervals`) es la fuente de verdad del recorrido; `fuel_vehicles.worksite_id` queda como espejo de la estadía abierta, y dos triggers de Postgres lo garantizan. Un único servicio (`lib/services/fleet-transfers.ts`) cambia faenas; el resto de los caminos lo usa o rechaza el cambio. Los reportes de historia unen cada evento con la estadía de su día mediante un helper SQL.

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle ORM + PostgreSQL (PGlite en pruebas), Vitest, Playwright, ExcelJS, Tailwind + componentes de `components/ui`.

**Spec:** `docs/superpowers/specs/2026-11-18-traslado-equipos-faena-design.md` (léelo antes de cualquier tarea; este plan argumenta desde él).

**Worktree:** `/home/allopze/dev/chome/bodega-wt/traslado-equipos`, rama `feat/traslado-equipos-faena`. Todo comando se corre ahí. Nunca en `/home/allopze/dev/chome/bodega` (checkout de otras sesiones).

## Global Constraints

- Leer `AGENTS.md` del repo antes de tocar código; reglas de layout, búsqueda, exportación (sólo Excel), fechas (`formatDate`, `todayInChile`) y migraciones aplican a todas las tareas.
- Migraciones: sólo `npm run db:generate`; nunca editar `meta/_journal.json` ni un `.sql` ya generado de otra rama; SQL propio anexado al final de la migración nueva, idempotente, separado por `--> statement-breakpoint`; luego `node scripts/verify-migration-chain.mjs --update-checksums`. Si `main` gana otra `0391_*` antes del merge, regenerar según `db/migrations/README.md`.
- Fechas civiles como texto `YYYY-MM-DD` (igual que `fuel_provider_mappings.effective_from`). Comparar texto con texto.
- El día del traslado ya cuenta en la faena nueva. `ended_on` de la estadía anterior = día anterior (`addDaysToPlainDate(date, -1)` de `@/lib/utils`).
- Ventana de fecha de un traslado por pantalla: desde el día 1 del mes anterior hasta hoy (decisión del usuario), y estrictamente posterior al `started_on` de la estadía actual cuando éste no es nulo.
- Motivo: ≥ 10 caracteres (trim). «Autorizado por»: ≥ 3 caracteres (trim). Anulación: motivo ≥ 10.
- Permiso nuevo `flota:transfer` (id `p-flot-transfer`, descripción «Trasladar equipos entre faenas y anular traslados») para `administrador`, `jefa_chome`, `jefe_mantencion`. Además, alcance sobre la faena actual de cada equipo y sobre la de destino.
- Copy en español de Chile, caja de oración, sin `uppercase`; colores de texto con tokens `-ink`.
- Toda prueba PGlite nueva se llama `*-pglite.test.ts` **y se agrega a `tests/pglite-files.ts`** (si no, corre en el proyecto paralelo y falla).
- Entre tareas: sólo `npx vitest run <archivos>` dirigido + `npx eslint <archivos>` + commit. Las puertas completas (typecheck, lint, test:fast, test:pglite, E2E, navegador) corren UNA vez en la Tarea 16 (preferencia del usuario).
- Subagentes: no `git stash`, `git checkout`, `git restore` ni `git reset`. Commits con `git commit -- <rutas>` y el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nada contra producción. La reconstrucción corre en `bodega_dev`; en prod sólo con autorización explícita del usuario y lo corre el usuario.

## Review Focus

1. **Dos personas trasladan el mismo equipo casi a la vez** (la segunda con la lista de candidatos ya vieja): la segunda debe recibir un error de fila legible («Ya está en Mininco» o el de fecha), nunca el error crudo del trigger. → prueba en Tarea 4 (`stale candidate`).
2. **Un camino olvidado cambia `worksite_id` directo** (script, importador): el trigger lo frena con un mensaje que contiene `FLEET_STAY_INVARIANT`; las acciones deben convertirlo en «Para cambiar de faena usa «Trasladar equipos».» y no en «Error al actualizar». → pruebas en Tareas 1 y 9.
3. **Borde de medianoche chilena**: un viaje GPS a las 23:30 del 14-11 (hora Chile, `2026-11-15T02:30:00Z`) con traslado desde el 15-11 sigue en la faena vieja. → prueba en Tarea 4.
4. **Casilla de faena en el modal con un filtro activo**: marca sólo los equipos visibles de ese grupo, no los ocultos por la búsqueda. → prueba en Tarea 7.
5. **Equipo sin ficha de Mantención** (sólo flota): el traslado no escribe historial de Mantención y no falla. → prueba en Tarea 4.

---

## Lanes (para ejecutar en paralelo)

- **Base (secuencial, primero):** Tareas 0 → 1 → 2 → 3.
- **Línea A — traslado y pantallas:** 4 → 5 → 6 → 7 → 8 → 9.
- **Línea B — reportes:** 10 → 11 → 12 → 13.
- **Línea C — reconstrucción:** 14 → 15.
- **Cierre:** 16, cuando las tres líneas terminaron.

Las líneas no comparten archivos, con dos excepciones: la Tarea 3 modifica `lib/auth/scope.ts` antes de que empiecen las líneas, y `tests/pglite-files.ts` lo tocan varias tareas: sólo se le AGREGAN líneas al final de la lista, releyendo el archivo justo antes de editarlo, y se commitea junto con la prueba que agrega.

---

### Task 0: Preparar el worktree

**Files:** ninguno.

- [ ] **Step 1:** `cd /home/allopze/dev/chome/bodega-wt/traslado-equipos && npm ci && npm run prepare` — Expected: termina sin errores; `node_modules/.bin/vitest` existe.
- [ ] **Step 2:** `cp /home/allopze/dev/chome/bodega/.env.local .` (no se commitea; está en `.gitignore`). No imprimir su contenido.
- [ ] **Step 3:** `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pglite-template.test.ts` — Expected: PASS (confirma que PGlite y las migraciones corren en este worktree).

---

### Task 1: Esquema, migración, triggers e invariante

**Files:**
- Create: `db/schema/fleet-transfers.ts`
- Modify: `db/schema/index.ts` (exportar el archivo nuevo)
- Modify: `db/schema/fleet-gps.ts:168-172, 211-215, 244, 277` (FK compuestas → FK simple)
- Create (generada): `db/migrations/0391_<nombre>.sql` + SQL anexado
- Modify: `db/migrations/meta/_sql-checksums.json` (vía script)
- Create: `lib/testing/fleet-stays.ts`
- Test: `lib/__tests__/fleet-worksite-stays-pglite.test.ts` (+ entrada en `tests/pglite-files.ts`)

**Interfaces:**
- Produces (Drizzle, `@/db/schema`): `fleetTransfers`, `fleetTransferItems`, `fuelVehicleWorksiteIntervals` y sus relaciones; tipo `FleetStaySource = "alta" | "traslado" | "reconstruccion"`.
- Produces: `setVehicleWorksiteForTest(db: DB, vehicleId: string, worksiteId: string, startedOn: string): Promise<void>` en `lib/testing/fleet-stays.ts` (cierra la estadía abierta el día anterior a `startedOn`, abre la nueva y actualiza `fuel_vehicles.worksite_id`, todo en una transacción).

Tablas (nombres exactos):

- `fleet_transfers`: `id` text pk; `folio` text not null unique; `effective_date` text not null; `to_worksite_id` → `worksites.id` not null; `reason` text not null; `authorized_by` text not null; `created_by` → `users.id` not null; `created_at` timestamptz default now; `voided_at` timestamptz; `voided_by` → `users.id`; `void_reason` text. Checks: `char_length(trim(reason)) >= 10`; `char_length(trim(authorized_by)) >= 3`; anulación completa (los tres nulos, o los tres con `char_length(trim(void_reason)) >= 10`), como `fleet_vehicle_documents_void_complete`. Índices: `effective_date`, `to_worksite_id`.
- `fleet_transfer_items`: `id` text pk; `transfer_id` → `fleet_transfers.id` on delete cascade; `vehicle_id` → `fuel_vehicles.id`; `from_worksite_id` → `worksites.id`. Único (`transfer_id`, `vehicle_id`); índice `vehicle_id`.
- `fuel_vehicle_worksite_intervals`: `id` text pk; `vehicle_id` → `fuel_vehicles.id` on delete cascade; `worksite_id` → `worksites.id`; `started_on` text (nulo = «desde siempre»); `ended_on` text (nulo = actual); `source` text not null; `transfer_id` → `fleet_transfers.id`; `evidence` text; `created_at`. Checks: `source IN ('alta','traslado','reconstruccion')`; `(source = 'traslado') = (transfer_id IS NOT NULL)`; `started_on IS NULL OR ended_on IS NULL OR ended_on >= started_on`. Índices: único parcial (`vehicle_id`) `WHERE ended_on IS NULL`; único parcial (`vehicle_id`) `WHERE started_on IS NULL`; (`vehicle_id`, `started_on`); (`worksite_id`).

GPS: en las cuatro tablas reemplazar `foreignKey({ columns: [vehicleId, worksiteId], foreignColumns: [fuelVehicles.id, fuelVehicles.worksiteId] }).onUpdate("cascade").onDelete("cascade")` por `foreignKey({ columns: [table.vehicleId], foreignColumns: [fuelVehicles.id], name: "<mismo nombre>_vehicle_fk" }).onDelete("cascade")`. Conservar los `check` de consistencia y el índice `fuel_vehicles_id_worksite_key`.

SQL anexado a la migración (en este orden):
1. Backfill: una estadía `alta` sin inicio ni fin por cada fila de `fuel_vehicles`, en su `worksite_id`, id `'fvwi_' || id`, `ON CONFLICT DO NOTHING`.
2. Función + trigger `fuel_vehicles_open_first_stay` `AFTER INSERT ON fuel_vehicles FOR EACH ROW`: inserta la estadía `alta` sin inicio ni fin (id `gen_random_uuid()::text`).
3. Función `fuel_vehicle_check_stays(p_vehicle text)` que, si el vehículo existe, hace `RAISE EXCEPTION 'FLEET_STAY_INVARIANT: …'` salvo que se cumpla TODO: hay ≥ 1 estadía; ordenadas por `started_on NULLS FIRST`, la primera tiene `started_on IS NULL`, cada siguiente tiene `started_on = (ended_on anterior)::date + 1` (como texto `YYYY-MM-DD`), sólo la última tiene `ended_on IS NULL`; y la faena de la última = `fuel_vehicles.worksite_id`.
4. Dos `CREATE CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED FOR EACH ROW` que llaman a la función: `fuel_vehicles_stays_consistency` (`AFTER INSERT OR UPDATE OF worksite_id ON fuel_vehicles`) y `fuel_vehicle_worksite_intervals_consistency` (`AFTER INSERT OR UPDATE OR DELETE ON fuel_vehicle_worksite_intervals`, con `COALESCE(NEW.vehicle_id, OLD.vehicle_id)`). Usar `DROP TRIGGER IF EXISTS` antes de cada `CREATE` para idempotencia.
5. Toggle apagado hasta la reconstrucción: `INSERT INTO system_settings (key, value) VALUES ('submodule.enabled:flota:/flota/traslados', 'false') ON CONFLICT (key) DO NOTHING`. (Clave con la forma de `submoduleKey()` en `lib/services/module-toggles.ts:36`; verificar el formato exacto ahí.)

- [ ] **Step 1: Write the failing test** `lib/__tests__/fleet-worksite-stays-pglite.test.ts` (setup como `lib/__tests__/mantencion-equipment-life-pglite.test.ts`: `new PGlite()`, `migratePGlite`, sembrar dos faenas `ws-a`, `ws-b`, un tipo de equipo y un usuario):
  - `it("al crear un vehículo abre su primera estadía sin inicio")` → tras `insert(fuelVehicles)` en `ws-a`, `select` de estadías da `[{ worksiteId: "ws-a", startedOn: null, endedOn: null, source: "alta" }]`.
  - `it("rechaza cambiar la faena sin mover la estadía")` → `update(fuelVehicles).set({ worksiteId: "ws-b" })` rechaza con un error cuyo mensaje contiene `FLEET_STAY_INVARIANT`.
  - `it("acepta cambiar faena y estadía en la misma transacción")` → `setVehicleWorksiteForTest(db, id, "ws-b", "2026-11-15")` resuelve; estadías = `[{ ws-a, null, "2026-11-14" }, { ws-b, "2026-11-15", null }]`.
  - `it("rechaza un hueco entre estadías")` → en una transacción, cerrar la abierta en `2026-11-10` y abrir otra desde `2026-11-15` con la faena actualizada: rechaza con `FLEET_STAY_INVARIANT`.
  - `it("las filas GPS ya no arrastran la faena")` → insertar una fila en `fleet_gps_position_history` con `worksite_id = 'ws-a'`, trasladar con el helper, la fila sigue con `ws-a`.
- [ ] **Step 2:** `npx vitest run --config vitest.pglite.config.ts lib/__tests__/fleet-worksite-stays-pglite.test.ts` — Expected: FAIL (tabla no existe).
- [ ] **Step 3:** Escribir `db/schema/fleet-transfers.ts`, exportarlo, cambiar las FK GPS, `npm run db:generate`, anexar el SQL, `node scripts/verify-migration-chain.mjs --update-checksums`, escribir `lib/testing/fleet-stays.ts`.
- [ ] **Step 4:** `npm run db:generate` otra vez — Expected: «No schema changes». `node scripts/verify-migration-chain.mjs` — Expected: OK.
- [ ] **Step 5:** Re-correr la prueba del Step 2 — Expected: PASS.
- [ ] **Step 6: Arreglar fixtures que cambian faena directo.** `grep -rn "worksiteId" --include=*.test.ts lib app components db e2e | grep -i -E "update\((schema\.)?fuelVehicles\)"` y `grep -rn "UPDATE fuel_vehicles" --include=*.ts lib app e2e scripts db`. Reemplazar cada cambio de faena de pruebas por `setVehicleWorksiteForTest`. Correr cada archivo tocado con vitest — Expected: PASS.
- [ ] **Step 7: Commit** `git commit -- db/schema db/migrations lib/testing/fleet-stays.ts lib/__tests__/fleet-worksite-stays-pglite.test.ts tests/pglite-files.ts <fixtures tocados> -m "feat(flota): estadías por faena, traslados e invariante en la base"`.

---

### Task 2: Reglas puras del traslado

**Files:**
- Create: `lib/fleet/transfer-rules.ts`
- Test: `lib/fleet/transfer-rules.test.ts`

**Interfaces:**
- Produces:
  - `transferDateWindow(today: string): { min: string; max: string }` — `min` = día 1 del mes anterior a `today`, `max` = `today`.
  - `transferDateError(date: string, today: string, currentStayStartedOn: string | null): string | null`
  - `transferTextErrors(input: { reason: string; authorizedBy: string }): Partial<Record<"reason" | "authorizedBy", string>>`
  - `formatTransferFolio(n: number): string` → `TR-0001`
  - `MAX_VEHICLES_PER_TRANSFER = 100`

- [ ] **Step 1: Write the failing test** con estos casos exactos:
  - `transferDateWindow("2026-11-18")` → `{ min: "2026-10-01", max: "2026-11-18" }`; `transferDateWindow("2026-01-05")` → `{ min: "2025-12-01", max: "2026-01-05" }`.
  - `transferDateError("2026-11-19", "2026-11-18", null)` → `"La fecha no puede ser posterior a hoy."`
  - `transferDateError("2026-09-30", "2026-11-18", null)` → `"La fecha no puede ser anterior al 01-10-2026."` (usar `formatDate` de `@/lib/utils`; ajustar el literal al formato que esa función devuelve).
  - `transferDateError("2026-10-02", "2026-11-18", "2026-10-02")` → `"Llegó a su faena actual el 02-10-2026: la fecha debe ser posterior."`
  - `transferDateError("2026-10-03", "2026-11-18", "2026-10-02")` → `null`; `transferDateError("2026-13-01", …)` → `"La fecha no es válida."`
  - `transferTextErrors({ reason: " corto ", authorizedBy: "G" })` → `{ reason: "Explica el motivo en al menos 10 caracteres.", authorizedBy: "Indica quién lo autorizó." }`
  - `formatTransferFolio(7)` → `"TR-0007"`; `formatTransferFolio(12345)` → `"TR-12345"`.
- [ ] **Step 2:** `npx vitest run lib/fleet/transfer-rules.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implementar (usar `addDaysToPlainDate`, `formatDate` de `@/lib/utils`; una fecha es válida si calza `^\d{4}-\d{2}-\d{2}$` y `new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)` la devuelve igual — `lib/utils` no exporta un validador; `copec-sync.ts` tiene uno local que no se reutiliza).
- [ ] **Step 4:** Re-correr — Expected: PASS. `npx eslint lib/fleet/transfer-rules.ts lib/fleet/transfer-rules.test.ts`.
- [ ] **Step 5: Commit** `feat(flota): reglas de fecha y texto del traslado`.

---

### Task 3: Helpers de estadía para consultas y recorrido

**Files:**
- Create: `lib/fleet/stays-sql.ts`
- Create: `lib/services/fleet-stays.ts`
- Modify: `lib/auth/scope.ts:86-104` (ampliar el tipo de columna)
- Test: `lib/__tests__/fleet-stays-pglite.test.ts` (+ `tests/pglite-files.ts`); caso nuevo en la prueba existente de `lib/auth/scope` (buscar `scope.test.ts`)

**Interfaces:**
- Consumes: tablas de la Tarea 1.
- Produces:
  - `stayWorksiteOnDaySql(vehicleId: AnyColumn | SQL, day: SQL): SQL<string | null>` — subconsulta correlacionada: `(SELECT i.worksite_id FROM fuel_vehicle_worksite_intervals i WHERE i.vehicle_id = <vehicleId> AND (i.started_on IS NULL OR i.started_on <= <day>) AND (i.ended_on IS NULL OR i.ended_on >= <day>))`. `day` debe ser texto `YYYY-MM-DD` (para timestamps usar `isoTextDaySql` que ya usa `lib/combustibles/control/queries/meter-rates.ts`; verificar dónde está exportada y que use hora de Chile).
  - `worksiteScopeSql(session, column: AnyColumn | SQL, worksiteId?)` y `worksiteScopeSqlFor(scope, column: AnyColumn | SQL, worksiteId?)`: mismo comportamiento, tipo ampliado.
  - `listVehicleStays(vehicleId: string): Promise<VehicleStay[]>` con `VehicleStay = { id: string; worksiteId: string; worksiteName: string; startedOn: string | null; endedOn: string | null; source: FleetStaySource; evidence: string | null; transfer: { id: string; folio: string; reason: string; authorizedBy: string; createdByName: string | null; voided: boolean } | null }`, ordenadas por `started_on NULLS FIRST`.

- [ ] **Step 1: Write the failing tests:**
  - `it("da la faena del día según la estadía")`: vehículo trasladado de `ws-a` a `ws-b` desde `2026-11-15` (con `setVehicleWorksiteForTest`); `select stayWorksiteOnDaySql(fuelVehicles.id, sql\`'2026-11-14'\`)` → `ws-a`; con `'2026-11-15'` → `ws-b`; con `'2020-01-01'` → `ws-a` (primera estadía sin inicio).
  - `it("lista el recorrido en orden con el traslado que abrió cada estadía")`: insertar un `fleet_transfers` + item + estadías coherentes → `listVehicleStays` devuelve dos filas, la segunda con `transfer.folio = "TR-0001"`.
  - En la prueba de scope: `worksiteScopeSqlFor(["ws-a"], sql\`x\`)` produce SQL sin lanzar.
- [ ] **Step 2:** correr — Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** correr — Expected: PASS; `npx eslint` sobre los archivos.
- [ ] **Step 5: Commit** `feat(flota): consulta de faena del día y recorrido del equipo`.

---

### Task 4: Servicio de traslado (registrar, anular, listar)

**Files:**
- Create: `lib/services/fleet-transfers.ts`
- Test: `lib/__tests__/fleet-transfers-pglite.test.ts` (+ `tests/pglite-files.ts`)

**Interfaces:**
- Consumes: Tarea 1 (tablas), Tarea 2 (`transferDateError`, `transferDateWindow`, `transferTextErrors`, `formatTransferFolio`, `MAX_VEHICLES_PER_TRANSFER`), `moveProviderMappingsWithVehicleTx` (`lib/combustibles/provider-mappings.ts:33`, pasando `effectiveFrom`), `writeEquipmentHistory` (`lib/services/mantencion/equipment-history.ts:95`, acción `"update"`), `recordAudit` (`lib/audit.ts:71`), `chileDayStartInstant` (`lib/utils.ts:471`).
- Produces:
  ```ts
  export interface TransferActor { userId: string; email: string | null; scope: string[] | "all" }
  export interface TransferInput { toWorksiteId: string; effectiveDate: string; reason: string; authorizedBy: string; vehicleIds: string[] }
  export interface TransferCandidate { vehicleId: string; code: string; plate: string; typeName: string; brand: string | null; worksiteId: string; worksiteName: string; stayStartedOn: string | null; openWorkOrderFolio: string | null; providerMappingCount: number }
  export type TransferOutcome =
    | { ok: true; message: string; data: { transferId: string; folio: string; moved: number; copecRecheckFrom: string | null; manualImportNotice: string | null } }
    | { ok: false; message: string; fieldErrors?: Partial<Record<"toWorksiteId" | "effectiveDate" | "reason" | "authorizedBy" | "vehicleIds", string>>; rowErrors?: Record<string, string> }
  export interface TransferListRow { id: string; folio: string; effectiveDate: string; toWorksiteId: string; toWorksiteName: string; items: Array<{ vehicleId: string; code: string; plate: string; fromWorksiteId: string; fromWorksiteName: string }>; reason: string; authorizedBy: string; createdByName: string | null; createdAt: string; voidedAt: string | null; voidReason: string | null; voidable: boolean }
  export async function listTransferCandidates(scope: string[] | "all"): Promise<TransferCandidate[]>
  export async function transferVehiclesTx(tx: Tx, actor: TransferActor, input: TransferInput, today: string): Promise<TransferOutcome>
  export async function transferVehicles(actor: TransferActor, input: TransferInput, today?: string): Promise<TransferOutcome>
  export async function voidTransfer(actor: TransferActor, input: { transferId: string; reason: string }, today?: string): Promise<{ ok: true; message: string } | { ok: false; message: string }>
  export async function listTransfers(scope: string[] | "all", filters: { from: string; to: string; worksiteId?: string }): Promise<TransferListRow[]>
  ```

Comportamiento (lo que las pruebas fijan):
- `transferVehiclesTx`: valida textos y destino (existe, activo, en alcance: «Esa faena no existe o está inactiva.» / «No administras la faena de destino.»), 1..100 equipos («Marca al menos un equipo.» / «Máximo 100 equipos por traslado.»). Bloquea las filas de `fuel_vehicles` con `FOR UPDATE`. Error por fila (en `rowErrors[vehicleId]`): dado de baja «Está dado de baja.»; fuera de alcance «Es de {faena}, una faena que no administras.»; ya en destino «Ya está en {destino}.»; fecha: `transferDateError(date, today, estadía.startedOn)`. Si hay algún error, no escribe nada y devuelve `ok: false` con `message: "Revisa los equipos marcados."`. Si no: folio bajo `pg_advisory_xact_lock(hashtext('fleet_transfer_folio'))` = cantidad de traslados + 1; inserta traslado e items; por equipo cierra la estadía abierta (`ended_on = date − 1`), abre la nueva (`source: "traslado"`), actualiza `fuel_vehicles.worksite_id` y `updated_at`, llama a `moveProviderMappingsWithVehicleTx({ …, effectiveFrom: date })`, re-estampa GPS (`fleet_gps_position_history.occurred_at`, `fleet_gps_trips.started_at`, `fleet_gps_alerts.occurred_at` ≥ `chileDayStartInstant(date)` → faena nueva; `fleet_gps_latest_positions` del vehículo → faena nueva), escribe historial de Mantención SÓLO si existe `mant_equipment_profiles` del vehículo (`summary: "Trasladado a {destino} desde el {fecha} ({folio})"`, `changes: { Faena: { from, to } }`), y una auditoría por equipo (`entityType: "fuel_vehicle"`, `action: "update"`, `oldState/newState` con `worksiteId`, `reason`) + una del traslado (`entityType: "fleet_transfer"`, `action: "create"`, `entityCode: folio`). `copecRecheckFrom` = día 1 del mes de `date` si `date` < día 1 del mes de `today`, si no `null`. `manualImportNotice`: si hay `fuel_consumption_records` del vehículo en la faena de origen con `periodo_hasta >= date` cuyo lote no sea de la sincronización Copec (fuentes de `copecTctSource(...)` en `lib/combustibles/copec-sync.ts`), el texto «{n} consumos importados a mano posteriores al {fecha} siguen en {origen}: revisa esos lotes.»; si no, `null`. Mensaje de éxito: «{folio}: {n} equipo pasa / equipos pasan a {destino} desde el {fecha}.»
- `transferVehicles`: corre `transferVehiclesTx` en `db.transaction`, mapea un error con `FLEET_STAY_INVARIANT` a `{ ok: false, message: "El equipo cambió de faena en otra sesión. Recarga e inténtalo de nuevo." }`, y tras confirmar, si `copecRecheckFrom`, llama a `requestCopecRecheckFrom` (Tarea 5; en esta tarea dejar la llamada detrás de un import que la Tarea 5 crea — si la Tarea 5 aún no existe, crear la función como stub que devuelve `{ requested: false }` en `lib/combustibles/copec-sync.ts` y la Tarea 5 la completa).
- `voidTransfer`: motivo ≥ 10 («Explica el motivo en al menos 10 caracteres.»); ya anulado → «Ese traslado ya está anulado.»; si para algún equipo la estadía abierta no es la que abrió este traslado → «No se puede anular: {código} se trasladó de nuevo después ({folio posterior}).». Si procede: borra esas estadías, reabre la anterior (`ended_on = NULL`), devuelve `worksite_id` a `from_worksite_id`, `moveProviderMappingsWithVehicleTx({ worksiteId: from, effectiveFrom: transfer.effectiveDate })`, re-estampa GPS de vuelta, historial de Mantención «Traslado {folio} anulado: vuelve a {origen}», auditoría `action: "void"` con `reason`, marca `voided_*`. Mensaje «{folio} anulado.»
- `listTransfers`: filtra por `effective_date` entre `from` y `to`, por faena de destino u origen si `worksiteId`, y por alcance (visible si destino o algún origen está en el alcance). `voidable` = no anulado y cada equipo sigue con la estadía que abrió este traslado.
- `listTransferCandidates`: equipos activos cuya faena actual está en el alcance, con `stayStartedOn` de la estadía abierta, folio de la OT abierta más reciente (estados distintos de `cerrada`/`anulada`) y cantidad de asignaciones de proveedor activas.

- [ ] **Step 1: Write the failing tests** (`ws-a` «Santa Fe», `ws-b` «Mininco», `ws-c` inactiva; hoy = `"2026-11-18"`):
  - `it("traslada dos equipos y deja recorrido, faena y folio")` → `ok: true`, `folio: "TR-0001"`, `moved: 2`; estadías de cada uno `[ws-a…2026-11-14, ws-b 2026-11-15…]`; `fuel_vehicles.worksite_id = ws-b`; mensaje `"TR-0001: 2 equipos pasan a Mininco desde el 15-11-2026."` (ajustar al formato de `formatDate`).
  - `it("todo o nada: un equipo inválido no mueve a ninguno")` → uno dado de baja; `ok: false`, `rowErrors[idBaja] = "Está dado de baja."`; el otro sigue en `ws-a`; no hay filas en `fleet_transfers`.
  - `it("rechaza destino inactivo y fuera de alcance")`.
  - `it("rechaza fecha anterior al 1 del mes anterior y anterior a la llegada")`.
  - `it("stale candidate: un segundo traslado del mismo equipo ve su estado nuevo")` → trasladar a `ws-b`; luego trasladar el mismo a `ws-b` → `rowErrors[id] = "Ya está en Mininco."`; luego a `ws-a` con fecha `2026-11-15` → error de fecha («…la fecha debe ser posterior.»).
  - `it("mueve las asignaciones de proveedor desde la fecha")` → una asignación activa en `ws-a` desde `2026-01-01`; queda cerrada con `effective_to = "2026-11-14"` y una nueva en `ws-b` desde `2026-11-15`.
  - `it("re-estampa GPS desde la medianoche chilena")` → viaje `started_at = "2026-11-15T02:30:00Z"` (23:30 del 14 en Chile) queda en `ws-a`; viaje `2026-11-15T04:00:00Z` pasa a `ws-b`.
  - `it("equipo sin ficha de Mantención no escribe historial y no falla")`; `it("equipo con ficha escribe «Trasladado a Mininco…»")`.
  - `it("copecRecheckFrom sólo si la fecha es del mes anterior")` → fecha `2026-10-20` → `"2026-10-01"`; fecha `2026-11-15` → `null`.
  - `it("anular devuelve todo")` → faena, estadías, asignación de proveedor y GPS como antes; `voided_at` lleno.
  - `it("no anula si hubo un traslado posterior")` → mensaje exacto con el folio posterior; `listTransfers` marca `voidable: false` en el primero.
- [ ] **Step 2:** `npx vitest run --config vitest.pglite.config.ts lib/__tests__/fleet-transfers-pglite.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implementar `lib/services/fleet-transfers.ts`.
- [ ] **Step 4:** Re-correr — Expected: PASS. `npx eslint lib/services/fleet-transfers.ts`.
- [ ] **Step 5: Commit** `feat(flota): servicio de traslado de equipos con anulación`.

---

### Task 5: Re-verificación de Copec para traslados del mes anterior

**Files:**
- Modify: `lib/combustibles/copec-sync.ts` (junto a `setCopecSyncStartDate`, ~l. 563)
- Test: `lib/__tests__/copec-recheck-pglite.test.ts` (+ `tests/pglite-files.ts`)

**Interfaces:**
- Produces: `requestCopecRecheckFrom(month: string): Promise<{ requested: boolean }>` — `month` = `YYYY-MM-01`. Si `month` < `firstUncoveredMonth(state)` y ≥ `firstDayOfMonth(configuredStart())`, guarda `requestedStart = month` con `saveState` (sin el control `expectedStart` de la pantalla; si `saveState` choca por versión, relee y reintenta una vez) y devuelve `{ requested: true }`; si no, `{ requested: false }`. No lanza: registra con `logger.warn` y devuelve `{ requested: false }`.

Por qué alcanza: el barrido reproyecta el mes pedido; la proyección agrupa por la faena que resuelven las asignaciones (`importCopecPeriod`, ~l. 940-1010), así que el grupo de cada faena cambia, su hash cambia y `replaceBatchRecords` mueve el consumo, incluido el reparto por día de un mes que cruza el traslado.

- [ ] **Step 1: Write the failing test:** con `system_settings` vacío y la cobertura de octubre y noviembre 2026 cerrada, `requestCopecRecheckFrom("2026-10-01")` → `{ requested: true }` y `getCopecSyncPlan()` empieza en `"2026-10-01"`; con `requestedStart` ya en `"2026-09-01"`, pedir `"2026-10-01"` → `{ requested: false }` (no adelanta). Mockear `today` como lo hacen las pruebas de `lib/combustibles/__tests__/copec-sync.test.ts`.
- [ ] **Step 2:** correr — Expected: FAIL.
- [ ] **Step 3:** Implementar (reemplaza el stub de la Tarea 4 si existe).
- [ ] **Step 4:** correr — Expected: PASS.
- [ ] **Step 5: Commit** `feat(combustibles): re-verificar Copec desde el mes de un traslado retroactivo`.

---

### Task 6: Permiso, menú y acciones de servidor

**Files:**
- Modify: `modules/flota/manifest.ts` (permiso, `permissionMeta`, ítem de menú, `defaultGrants`)
- Modify: `components/layout/nav-icons.tsx` (agregar `ArrowsLeftRight` de Phosphor a los dos mapas)
- Create: `app/(app)/flota/traslados/actions.ts`
- Test: `app/(app)/flota/traslados/actions.test.ts`; correr `components/layout/nav-rows-groups.test.tsx` y la prueba de navegación existente (`grep -rl "navigation.test" lib components`)

**Interfaces:**
- Consumes: Tarea 4.
- Produces (server actions, `"use server"`):
  - `listTransferCandidatesAction(): Promise<{ ok: true; data: { candidates: TransferCandidate[]; worksites: Array<{ id: string; name: string }>; window: { min: string; max: string } } } | { ok: false; message: string }>` — `worksites` = faenas activas en alcance.
  - `transferVehiclesAction(input: TransferInput): Promise<TransferOutcome>`
  - `voidTransferAction(input: { transferId: string; reason: string }): Promise<{ ok: boolean; message: string }>`
  - `exportTransfersAction(filters: { from: string; to: string; worksiteId?: string }): Promise<ExportActionResult>` (tipo de `components/ui/export-button.tsx:16`; armar el libro como el export de `app/(app)/flota/actions.ts:~230`).
- Cada acción: `guardPermission("flota:transfer", "/flota/traslados")` (export: `flota:export`; lista de candidatos: `flota:transfer`), `isRouteOperational("/flota/traslados")` → si no, `{ ok: false, message: "Los traslados aún no están habilitados." }`, zod para la forma, `actor.scope = serviceWorksiteScope(session)`, y tras éxito `revalidatePath` de `/flota`, `/flota/traslados`, la ficha de cada equipo (`revalidateVehicleFicha` de donde lo importa `actions-module/vehicles.ts`), `/mantencion/equipos`.
- Menú: ítem `{ label: "Traslados", href: "/flota/traslados", iconName: "ArrowsLeftRight", permissions: ["flota:view"], group: "Flota" }` después de «Vehículos».
- Excel (una fila por equipo): Folio, Fecha, Código, Patente, Desde, A, Motivo, Autorizado por, Registrado por, Registrado el, Estado («Vigente»/«Anulado»), Motivo de anulación. Fechas como fecha real de Excel.

- [ ] **Step 1: Write the failing tests** (mockear servicio y sesión como otras pruebas de acciones, p. ej. `app/(app)/mantencion/equipos/actions.test.ts`): sin permiso → `ok: false`; toggle apagado → `"Los traslados aún no están habilitados."`; con permiso pasa `scope` y revalida `/flota/traslados`.
- [ ] **Step 2:** `npx vitest run "app/(app)/flota/traslados/actions.test.ts"` — Expected: FAIL.
- [ ] **Step 3:** Implementar manifest, ícono y acciones.
- [ ] **Step 4:** correr esa prueba y las de navegación — Expected: PASS.
- [ ] **Step 5: Commit** `feat(flota): permiso, menú y acciones de traslados`.

---

### Task 7: Modal «Trasladar equipos»

**Files:**
- Create: `components/fleet/transfer/transfer-summary.ts`
- Create: `components/fleet/transfer/transfer-equipment-list.tsx`
- Create: `components/fleet/transfer/transfer-dialog.tsx`
- Create: `components/fleet/transfer/transfer-button.tsx`
- Test: `components/__tests__/fleet-transfer-dialog.test.tsx`, `components/fleet/transfer/transfer-summary.test.ts`

**Interfaces:**
- Consumes: Tarea 6 (acciones), tipos de la Tarea 4.
- Produces:
  - `TransferButton({ initialVehicleId?: string; label?: string; variant?: ButtonVariant }): JSX.Element` (cliente). Al abrir llama a `listTransferCandidatesAction()` y monta el diálogo; mientras carga, el botón queda en `loading`.
  - `transferRowNotes(candidate: TransferCandidate, toWorksiteName: string, effectiveDate: string): string[]` → «Sale de {faena}», y si aplica «Tiene la {OT} abierta en {faena}: la OT se queda en {faena}», «Tiene asignación Copec: pasa a {destino} desde el {fecha}».
  - `transferSummaryText(count: number, toWorksiteName: string | null, effectiveDate: string): string` → `"Marca los equipos que se trasladan."` (0), `"1 equipo pasa a Mininco desde el 15-11-2026"`, `"3 equipos pasan a …"`.

Diseño (copiar estructura y clases de `components/mantencion/jefatura/pautas/assign-equipment-dialog.tsx` y `assign-equipment-list.tsx`): `DialogContent` con el mismo alto fijo; arriba `Field`s «A la faena» (`OptionSelect`, sólo faenas de `worksites`), «Desde el» (`DatePicker` con `min`/`max` de `window`, default hoy), «Motivo» (`Textarea`), «Autorizado por» (`Input`); debajo buscador propio del modal + filtro por tipo; lista agrupada por faena actual con casilla por grupo (marca/desmarca sólo los visibles del grupo) y por equipo, `VehicleIdentity` en cada fila, notas de `transferRowNotes`, y el `rowErrors[vehicleId]` del servidor en `text-[var(--color-danger-ink)]` bajo su fila; los equipos que ya están en la faena destino no se listan; pie con `transferSummaryText` (`aria-live="polite"`), «Cancelar» y «Trasladar» (deshabilitado con 0 marcados). Éxito: `toast.success(message)` + `toast` adicional con `manualImportNotice` si viene, cerrar, `router.refresh()`. `initialVehicleId` llega marcado y su grupo abierto.

- [ ] **Step 1: Write the failing tests:**
  - `transfer-summary.test.ts`: los tres textos de `transferSummaryText` y las tres notas de `transferRowNotes` con valores exactos.
  - `fleet-transfer-dialog.test.tsx` (Testing Library, mockear acciones): elegir destino «Mininco» oculta los equipos que ya están en Mininco; escribir «KA-7» y marcar la casilla del grupo «Santa Fe» marca sólo los visibles (Review Focus 4); `rowErrors` del servidor aparece bajo la fila correcta; `initialVehicleId` llega marcado.
- [ ] **Step 2:** `npx vitest run components/__tests__/fleet-transfer-dialog.test.tsx components/fleet/transfer/transfer-summary.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** correr — Expected: PASS; `npx eslint components/fleet/transfer`.
- [ ] **Step 5: Commit** `feat(flota): modal para trasladar uno o varios equipos`.

---

### Task 8: Lista de traslados, botón en Flota y recorrido en la ficha

**Files:**
- Create: `app/(app)/flota/traslados/page.tsx`, `app/(app)/flota/traslados/loading.tsx`, `app/(app)/flota/traslados/transfers-table.tsx`, `app/(app)/flota/traslados/void-transfer-dialog.tsx`
- Modify: `app/(app)/flota/page.tsx` (agregar `TransferButton` a `PageHeader.actions` cuando `can(session, "flota:transfer")` y `await isRouteOperational("/flota/traslados")`)
- Modify: `app/(app)/flota/[id]/flota/page.tsx` (botón «Trasladar» con `initialVehicleId` en las acciones de cabecera bajo la misma condición + `canAccessWorksite`; tarjeta «Recorrido por faena» antes de «Historial de estado operacional», l. ~197)
- Test: `app/(app)/flota/traslados/transfers-table.test.tsx`

**Interfaces:**
- Consumes: Tareas 3 (`listVehicleStays`), 4 (`listTransfers`), 6 (acciones), 7 (`TransferButton`).

Página `/flota/traslados` (reglas de AGENTS.md: `PageContainer` + `PageHeader`, sin `<h1>` propio, sin buscador propio):
- Gate: `requirePermission("flota:view")`; si `!isRouteOperational` → `redirect("/flota")`.
- `PageHeader` título «Traslados», descripción «Equipos trasladados entre faenas, con su fecha, motivo y quién lo autorizó.», `actions` = `TransferButton` (si `flota:transfer`) + `ExportButton` (si `flota:export`) con los filtros vigentes.
- Filtros estructurados: `PeriodControl` (período de `effective_date`; default año en curso, `router.replace` + `scroll: false`) y faena (`OptionSelect` «Todas las faenas»), en URL.
- `DataTable` con `searchKeys` (folio, códigos, patentes, faenas, motivo, autorizado por): Folio (mono), Fecha, Equipos (lista de `VehicleIdentity` con «desde {origen}»), A la faena, Motivo, Autorizado por, Registrado por, Estado (`Badge` «Vigente»/«Anulado» con motivo en `title`), acción «Anular» sólo si `voidable` y `flota:transfer`.
- Estado vacío con `EmptyState`: «Aún no hay traslados registrados», «Cuando Gerencia mueva equipos de faena, regístralo aquí para que quede su recorrido.», CTA `TransferButton` (si tiene permiso).
- `void-transfer-dialog.tsx`: `Dialog` con `Field` «Motivo de la anulación» (≥ 10) y botón destructivo «Anular traslado»; usa `useOperation`.

Recorrido en la ficha: `Card` «Recorrido por faena» con una fila por estadía (faena, «Desde» = `formatDate(startedOn)` o «Desde el inicio del registro», «Hasta» = `formatDate(endedOn)` o «Hoy», días si ambos extremos existen, y el origen: «{folio} · {motivo} · autorizado por {x} · registrado por {y}», «Reconstruido · {evidence}» o «Alta»). Visible a quien ve la pestaña Flota.

- [ ] **Step 1: Write the failing test** `transfers-table.test.tsx`: con dos filas (una anulada, otra `voidable`), la anulada muestra «Anulado» y no ofrece «Anular»; la otra sí; sin filas muestra el estado vacío con su CTA.
- [ ] **Step 2:** correr — Expected: FAIL.
- [ ] **Step 3:** Implementar página, tabla, diálogo, botón en `/flota` y en la ficha, tarjeta de recorrido.
- [ ] **Step 4:** correr la prueba + `"app/(app)/flota/[id]/ficha.test.tsx"` — Expected: PASS; `npx eslint` sobre los archivos.
- [ ] **Step 5: Commit** `feat(flota): lista de traslados y recorrido por faena en la ficha`.

---

### Task 9: Cerrar las otras puertas

**Files:**
- Modify: `app/(app)/combustibles/vehiculos/vehicle-form.tsx:290-296, 399-405` (faena de solo lectura al editar)
- Modify: `app/(app)/combustibles/actions-module/vehicles.ts` (`updateFuelVehicleAction` ~l. 239-345; importación ~l. 560-600)
- Modify: `lib/services/mantencion/equipment.ts` (`applyCreate` ~l. 85-125, `applyUpdate` ~l. 225-255) y el validador de filas de `lib/services/mantencion/equipment-import.ts`
- Modify: `lib/services/mantencion/seed-equipment.ts:148` si sus `fills` incluyen `worksiteId`
- Modify: `app/(app)/combustibles/actions-module/loads.ts:105` (`dbErrMsg`, async) para `FLEET_STAY_INVARIANT`
- Modify: `AGENTS.md` (sección corta «Faena de un equipo: sólo por traslado»: cualquier código o script que mueva un equipo de faena usa `transferVehiclesTx`; un `UPDATE` directo de `fuel_vehicles.worksite_id` falla por diseño con `FLEET_STAY_INVARIANT`)
- Test: casos nuevos en `app/(app)/combustibles/actions-vehicles.test.ts`, `app/(app)/mantencion/equipos/actions.test.ts` y una prueba PGlite de incorporación (`lib/__tests__/mantencion-incorporate-transfer-pglite.test.ts` + `tests/pglite-files.ts`)

**Interfaces:**
- Consumes: `transferVehiclesTx` (Tarea 4), `TransferButton` (Tarea 7).

Cambios:
- Formulario del padrón, edición de un vehículo existente: en vez del `Select`, el nombre de la faena como texto + `<input type="hidden" name="worksiteId" value={vehicle.worksiteId}>` + `TransferButton initialVehicleId={vehicle.id} label="Trasladar" variant="ghost"` (sólo si el usuario tiene `flota:transfer`; pasar ese booleano por props desde la página). En el alta, sin cambios.
- `updateFuelVehicleAction`: si `parsed.data.worksiteId` difiere de `existing.worksiteId` → `{ ok: false, message: "Revisa los datos", fieldErrors: { worksiteId: ["Para cambiar de faena usa «Trasladar equipos»."] } }`; quitar su llamada a `moveProviderMappingsWithVehicleTx`.
- Importación del padrón: fila existente con otra faena → error de fila en la columna de faena con el mismo texto; quitar su `moveProviderMappingsWithVehicleTx`.
- Mantención, importación (`applyUpdate` con `origin: "import"`) y validación de filas: misma regla y texto. `applyUpdate` ya no escribe `worksiteId` ni mueve asignaciones.
- `applyCreate` con `incorporate` y faena distinta: primero `transferVehiclesTx(tx, { userId, email, scope }, { toWorksiteId, effectiveDate: today, reason: "Incorporación a Mantención de equipos", authorizedBy: "Mantención de equipos", vehicleIds: [vehicleId] }, today)`; si `ok: false`, devolver su mensaje como `equipmentFailure({ worksiteId: … })`; luego el `update` de los demás campos SIN `worksiteId`, y sin su propio `moveProviderMappingsWithVehicleTx`.
- `dbErrMsg` (o equivalente): un error cuyo mensaje contiene `FLEET_STAY_INVARIANT` → «Para cambiar de faena usa «Trasladar equipos».»

- [ ] **Step 1: Write the failing tests:**
  - `updateFuelVehicleAction` con otra faena → `fieldErrors.worksiteId[0] === "Para cambiar de faena usa «Trasladar equipos»."` y la faena no cambia.
  - Importación del padrón con una fila que cambia faena → error de esa fila, el resto se importa.
  - Incorporar desde la flota a otra faena (PGlite) → crea `TR-0001` con motivo «Incorporación a Mantención de equipos» y el recorrido queda con dos estadías.
  - `await dbErrMsg(new Error("FLEET_STAY_INVARIANT: …"), "x")` → el texto de arriba.
- [ ] **Step 2:** correr esos archivos — Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** correr — Expected: PASS; además `npx vitest run "app/(app)/combustibles/vehiculos/vehicle-form-maintenance.test.tsx"`.
- [ ] **Step 5: Commit** `feat(flota): la faena sólo cambia por traslado`.

---

### Task 10: Combustible por la faena del día

**Files:**
- Modify: `lib/combustibles/consumption-dashboard.ts:332-352` (`getWorksiteEquipmentMatrix`)
- Modify: `lib/combustibles/control/queries/idle.ts:28-33` (`vehicleScopeSql`)
- Modify: `lib/combustibles/control/queries/idle-comparison.ts:~55-62`
- Modify: `lib/combustibles/control/queries/meter-rates.ts:~80-88`
- Test: `lib/__tests__/fleet-stays-combustible-pglite.test.ts` (+ `tests/pglite-files.ts`)

**Interfaces:**
- Consumes: `stayWorksiteOnDaySql`, `worksiteScopeSql` ampliado (Tarea 3).

Cambios:
- Mapa faena × equipo: unir `worksites` por `fuelConsumptionRecords.worksiteId` y agrupar por esa faena.
- `idle.ts`: el filtro de faena y de mandante sobre `stayWorksiteOnDaySql(fuelTelemetryDaily.vehicleId, <día de la fila como texto YYYY-MM-DD>)` en vez de `fuelVehicles.worksiteId`.
- `idle-comparison.ts`: lado cargas por `fuelEquipmentLoads.worksiteId`; lado telemetría como `idle.ts`.
- `meter-rates.ts`: filtro sobre `stayWorksiteOnDaySql(fuelMeterReadings.vehicleId, isoTextDaySql(fuelMeterReadings.occurredAt))`.
- Rótulos de faena por equipo que estas consultas devuelvan para mostrar quedan con la faena actual (spec, casos dudosos).

- [ ] **Step 1: Write the failing test:** un equipo con telemetría diaria y lecturas del 10 al 20-11-2026, trasladado de `ws-a` a `ws-b` desde el 15-11 (`setVehicleWorksiteForTest`). Filtrando por `ws-a`: `dailyTelemetry` devuelve sólo días 10-14; por `ws-b`: 15-20. `getMeterRateSeries` igual con las lecturas. El mapa de calor con dos registros de consumo del mismo equipo, uno en `ws-a` y otro en `ws-b` (columna propia), devuelve dos celdas, una por faena.
- [ ] **Step 2:** correr — Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** correr + las pruebas existentes de esos archivos (`grep -rl "idle\|meter-rates\|consumption-dashboard" lib --include=*.test.ts`) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(combustibles): reportes por la faena del día`.

---

### Task 11: Indicadores GPS por la faena del día

**Files:**
- Modify: `lib/services/fleet-gps-indicators.ts:~170-180` (`vehicleScope`), `:~375-395` (`byWorksite`)
- Test: casos nuevos en `lib/services/fleet-gps-indicators-pglite.test.ts`

**Interfaces:**
- Consumes: Tarea 3.

Cambios: cada viaje (`started_at`), alerta (`occurred_at`) y lectura (`occurred_at`) se filtra y se agrupa por `stayWorksiteOnDaySql(<vehicleId>, isoTextDaySql(<timestamp>))`. La lista de vehículos para rotular sigue con la faena actual.

- [ ] **Step 1: Write the failing test:** equipo trasladado desde el 15-11 con un viaje el 12-11 y otro el 17-11: el uso por faena pone el km del 12 en `ws-a` y el del 17 en `ws-b`; filtrar por `ws-a` excluye el del 17.
- [ ] **Step 2:** correr — Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** correr el archivo completo — Expected: PASS.
- [ ] **Step 5: Commit** `feat(flota): indicadores GPS por la faena del día`.

---

### Task 12: Días fuera de servicio por la faena del día

**Files:**
- Modify: `lib/services/mantencion/indicators.ts:445-470` (`loadOutOfService`)
- Test: caso nuevo en `lib/services/mantencion/indicators-pglite.test.ts`

**Interfaces:**
- Consumes: tablas de la Tarea 1; `worksiteScopeSqlFor` ampliado (Tarea 3).

Cambio: unir `fuel_vehicle_operational_intervals` con `fuel_vehicle_worksite_intervals` del mismo vehículo cuando se solapan, recortar cada intervalo a la intersección (inicio = mayor entre `started_at` del intervalo y `chileDayStartInstant(stay.started_on)` si existe; fin = menor entre `ended_at` y `chileDayStartInstant(stay.ended_on + 1 día)` si existe) y aplicar el alcance y el filtro de faena sobre `stay.worksite_id`. La lógica de baldes existente consume los intervalos ya recortados.

- [ ] **Step 1: Write the failing test:** equipo fuera de servicio del 12 al 18-11, trasladado desde el 15-11: con filtro `ws-a` cuenta 3 días (12, 13, 14); con `ws-b`, 4 (15-18).
- [ ] **Step 2:** correr — Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** correr el archivo completo — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mantencion): días fuera de servicio por la faena del día`.

---

### Task 13: Detector de anomalías e importador de consumos

**Files:**
- Modify: `lib/combustibles/anomaly-detector.ts:~380` (caso sobre envío TAE: `fuelTaeSubmissions.worksiteId`), `:~866` (salto de medidor: `stayWorksiteOnDaySql` del día de la lectura)
- Modify: `app/(app)/combustibles/actions-consumos.ts:91-110` (`findVehiclesByPlate`)
- Test: casos nuevos en las pruebas existentes del detector (`grep -rl "anomaly-detector" lib --include=*.test.ts`) y de `actions-consumos` (o una PGlite nueva + `tests/pglite-files.ts`)

**Interfaces:**
- Produces: `findVehiclesByPlate(plates: string[], worksiteId: string, period: { from: string; to: string })` — con `worksiteId !== "all"`, acepta un vehículo si tiene alguna estadía en `worksiteId` que se solape con `[from, to]` (no sólo si hoy está ahí). Actualizar el comentario de invariante del archivo y sus llamadas.
- `lib/services/operational-control.ts:322`: sin cambio (su alcance sólo elige la lista actual de vehículos; los conteos son por vehículo). Dejar un comentario de una línea que lo diga.

- [ ] **Step 1: Write the failing tests:** un lote manual de `ws-a` del 01 al 31-10 reconoce la patente de un equipo que hoy está en `ws-b` pero estuvo en `ws-a` hasta el 14-11; el caso de anomalía sobre un envío TAE de `ws-a` queda con `worksite_id = ws-a` aunque el equipo ya esté en `ws-b`.
- [ ] **Step 2:** correr — Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** correr — Expected: PASS.
- [ ] **Step 5: Commit** `fix(combustibles): anomalías e importador usan la faena del evento`.

---

### Task 14: Algoritmo de reconstrucción (puro)

**Files:**
- Create: `lib/fleet/stay-reconstruction.ts`
- Test: `lib/fleet/stay-reconstruction.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EvidenceKind = "carga" | "carga_terreno" | "tae" | "registro_mantencion" | "ot" | "auditoria" | "planilla"
  export interface StayEvidence { day: string; worksiteId: string; kind: EvidenceKind; ref: string }
  export interface ReconstructedStay { worksiteId: string; startedOn: string | null; endedOn: string | null; evidence: string }
  export type PendingReason = "ventana_amplia" | "contradiccion" | "planilla" | "faena_actual_distinta"
  export interface PendingChange { reason: PendingReason; fromWorksiteId: string | null; toWorksiteId: string; lastDayInFrom: string | null; firstDayInTo: string; gapDays: number | null; detail: string }
  export function reconstructStays(input: { evidence: StayEvidence[]; currentWorksiteId: string; maxGapDays: number }): { stays: ReconstructedStay[]; toConfirm: PendingChange[]; confident: boolean }
  ```

Reglas (spec § Reconstrucción): ordenar por día; la evidencia `planilla` no crea bordes, sólo se contrasta al final; el mismo día con dos faenas distintas → `contradiccion`; tramos consecutivos de la misma faena se funden; un cambio A→B se acepta si `firstDayInTo − lastDayInFrom ≤ maxGapDays` (borde = `firstDayInTo`), si no → `ventana_amplia`; la primera estadía con `startedOn: null`, la última con `endedOn: null`; última faena ≠ `currentWorksiteId` → `faena_actual_distinta`; una `planilla` cuyo día cae en una estadía de otra faena → `planilla`; `confident = toConfirm.length === 0`; sin evidencia → una estadía `{ currentWorksiteId, null, null, evidence: "Sin evidencia: faena actual" }`, `confident: true`. `evidence` resume conteos por tipo y el rango: «4 cargas, 2 registros de mantención entre 02-08-2026 y 14-09-2026».

- [ ] **Step 1: Write the failing tests:** (a) sin evidencia; (b) sólo `ws-a` y actual `ws-a` → una estadía; (c) `ws-a` hasta 10-09 y `ws-b` desde 14-09, actual `ws-b`, gap 7 → dos estadías con borde `2026-09-14`; (d) misma con `ws-b` desde 20-09 → `ventana_amplia`, `confident: false`; (e) dos faenas el 05-09 → `contradiccion`; (f) última `ws-a` y actual `ws-b` → `faena_actual_distinta`; (g) `planilla` `ws-c` el 21-08 dentro de una estadía `ws-a` → `planilla`; (h) el texto exacto de `evidence` del caso (c).
- [ ] **Step 2:** `npx vitest run lib/fleet/stay-reconstruction.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** correr — Expected: PASS.
- [ ] **Step 5: Commit** `feat(flota): algoritmo de reconstrucción del recorrido`.

---

### Task 15: Script de reconstrucción

**Files:**
- Create: `scripts/reconstruct-worksite-stays.ts`
- Create: `lib/fleet/stay-evidence.ts` (consultas de evidencia, testeable)
- Test: `lib/__tests__/fleet-stay-evidence-pglite.test.ts` (+ `tests/pglite-files.ts`)

**Interfaces:**
- Consumes: Tarea 14.
- Produces: `loadStayEvidence(db: DB, vehicleIds?: string[]): Promise<Map<string, StayEvidence[]>>` con estas fuentes y nada más:
  - `fuel_loads` (`load_date`, `worksite_id`, `status <> 'cancelled'`) → `carga`;
  - `fuel_equipment_loads` (`occurred_at` en día chileno, `worksite_id`, `voided_at IS NULL`, `source IN ('field','operations_import')`) → `carga_terreno`;
  - `fuel_tae_submissions` (`loaded_at` en día chileno, `worksite_id`, `vehicle_id` no nulo, estado no rechazado) → `tae`;
  - `mant_records` (`work_date`, `worksite_id`, `status = 'vigente'`, `out_of_worksite = false`) → `registro_mantencion`;
  - `mant_work_orders` (`request_date`, `worksite_id`, `status <> 'anulada'`) → `ot`;
  - `audit_log` de `entity_type IN ('fuel_vehicle','mant_equipment')` con `new_state->>'worksiteId'` distinto de `old_state->>'worksiteId'` → `auditoria` en la faena nueva el día de `created_at` (Chile);
  - NUNCA `fuel_consumption_records`, asignaciones de proveedor ni filas GPS.
- Script (`tsx --env-file=.env.local scripts/reconstruct-worksite-stays.ts [--apply] [--max-gap-days=7] [--snapshots=<archivo.json>] --out=<informe.xlsx>`):
  - `--snapshots`: JSON `[{ "date": "2026-08-21", "code": "KA-71", "plate": "CBJY-18", "worksiteName": "Santa Fe" }]` → evidencia `planilla` (vehículo por patente normalizada con `plateMatchKey`, luego por código; faena por nombre sin tildes ni mayúsculas; lo que no calza va a una hoja «Sin calce»). Ese JSON se arma en el despliegue con el usuario desde las planillas (sus erratas conocidas exigen sus decisiones); el script no lee los `.xlsx` de la raíz.
  - Informe Excel con hojas «Se aplica», «Por confirmar», «Sin evidencia», «Saltados (con traslado)», «Sin calce»; columnas con código, patente, faenas, fechas, motivo y evidencia.
  - Sin `--apply` no escribe. Con `--apply`, por vehículo con `confident` y sin estadías `traslado`: en una transacción borra sus estadías `alta`/`reconstruccion`, inserta las reconstruidas (`source: "reconstruccion"`; si queda una sola estadía sin inicio, `alta`) y una auditoría (`entityType: "fuel_vehicle_worksite_intervals"`, `action: "update"`, `reason: "Reconstrucción del recorrido por faena"`). Vehículos con traslado: se saltan y se informan. Re-ejecutable.
  - Imprime sólo conteos (nada de credenciales ni URL de BD).

- [ ] **Step 1: Write the failing test** de `loadStayEvidence`: con una carga `cancelled`, un registro anulado, un registro `out_of_worksite`, un consumo de Copec y una carga válida, devuelve sólo la válida (más los que correspondan), con el día chileno correcto para un `occurred_at` de las 23:30 Chile.
- [ ] **Step 2:** correr — Expected: FAIL.
- [ ] **Step 3:** Implementar `lib/fleet/stay-evidence.ts` y el script.
- [ ] **Step 4:** correr la prueba — Expected: PASS. Correr el script en seco contra `bodega_dev` (`.env.local` del worktree) con `--out=/tmp/claude-1000/-home-allopze-dev-chome-bodega/recorrido-dry-run.xlsx` — Expected: termina, imprime conteos por hoja, no escribe (verificar con `select count(*) from fuel_vehicle_worksite_intervals where source = 'reconstruccion'` = 0).
- [ ] **Step 5: Commit** `feat(flota): script de reconstrucción del recorrido por faena`.

---

### Task 16: Puertas finales, E2E y verificación en navegador

**Files:**
- Create: `e2e/traslado-equipos.spec.ts`
- Modify: `e2e/setup-db.ts`: upsert de `system_settings` `submodule.enabled:flota:/flota/traslados` = `'true'` (la migración lo deja en `'false'`), y un segundo vehículo en `ws-e2e` si falta (no tocar otros datos)
- Create: `qa/reports/2026-11-18-traslado-equipos.md`

- [ ] **Step 1: Write the E2E** (`login` de `e2e/helpers.ts`; localizadores por rol, `exact: true` donde un rótulo es prefijo de otro; nada de `.first()`): abrir `/flota`, «Trasladar equipos», elegir la otra faena, marcar el grupo de `ws-e2e`, motivo y autorizado por, «Trasladar» → toast con `TR-`; `/flota/traslados` muestra la fila; la ficha del equipo muestra dos estadías en «Recorrido por faena»; «Anular» con motivo → la fila dice «Anulado» y la ficha vuelve a una estadía. Otro caso: el usuario sin `flota:transfer` no ve el botón.
- [ ] **Step 2: Puertas** (una sola pasada, en este worktree): `npm run typecheck`, `npm run lint`, `npm run check:secrets`, `npm run test:fast`, `npm run test:pglite`, `npm run db:verify-migrations`, `npm run test:e2e` (borra `.next` de ESTE worktree; no correr en el checkout principal). Expected: todo verde; cualquier rojo se investiga con `superpowers:systematic-debugging` antes de tocar código.
- [ ] **Step 3: Navegador** contra `bodega_dev` con `next dev` del worktree en un puerto libre (p. ej. `:3003`, con su propio `AUTH_URL`): migrar `bodega_dev` (`npm run db:migrate`), correr la reconstrucción en seco, habilitar el toggle, trasladar con un usuario `jefe_mantencion` dos equipos `QA_` o de datos mock, revisar `/flota/traslados`, la ficha, `/combustibles/consumo/motor-en-vacio`, `/flota/indicadores` y `/mantencion/panel` filtrando por cada faena; capturar consola y red sin errores nuevos.
- [ ] **Step 4:** Escribir `qa/reports/2026-11-18-traslado-equipos.md` con lo verificado, lo no recorrido y los hallazgos (categorías de AGENTS.md).
- [ ] **Step 5: Commit** `test(flota): E2E del traslado de equipos y reporte de QA`.

**Despliegue (no lo ejecuta el agente; queda para el usuario):** migración → reconstrucción en seco en prod con el JSON de planillas acordado → revisión de «Por confirmar» con el usuario → `--apply` → encender `submodule.enabled:flota:/flota/traslados` → registrar por pantalla los cambios de la planilla de noviembre de Alexis.
