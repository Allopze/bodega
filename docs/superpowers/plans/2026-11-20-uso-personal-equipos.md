# Uso personal de equipos — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marcar en un equipo los períodos de uso personal del dueño, para que en esos días el equipo no sume plata, litros, km, horas ni ralentí en ningún agregado de gestión. Pagos, conciliaciones, registros y Mantención siguen viéndolo todo.

**Architecture:** Una tabla de períodos por equipo, con días de Chile inclusivos y `ended_on` nulo para un período abierto. Encima van dos piezas compartidas: un predicado SQL correlacionado, `lib/fleet/personal-use-sql.ts` (con el mismo patrón que `stayWorksiteOnDaySql`), y su equivalente en memoria, `lib/fleet/personal-use.ts`. Cada agregado de gestión usa una de las dos. El TCT mensual y los registros de consumo por período se multiplican por la fracción de días que queda fuera del uso personal. La marca se hace desde la ficha del equipo.

**Tech Stack:** Next.js 16 (app router, server actions), Drizzle + PostgreSQL, Vitest (`test:fast` y `test:pglite`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-uso-personal-equipos-design.md` (aprobado 2026-11-20). Léelo antes de cada tarea: §5.2 y §5.3 definen qué se excluye y qué no.

## Global Constraints

- Días = **día calendario de Chile**. Para columnas de texto ISO (`fuel_provider_transactions.occurred_at`, `fuel_meter_readings.occurred_at`, `purchase_orders.issued_at`) usa `isoTextDaySql` (`lib/combustibles/control/queries/field-filters.ts:53`), nunca `left(x,10)`. Para `timestamptz` usa `chileDateSql` (`lib/combustibles/control/filters.ts:89`). Para columnas que ya son texto `YYYY-MM-DD` (`fuel_telemetry_daily.day`, `fuel_loads.load_date`, `periodo_desde/hasta`), úsalas tal cual.
- `started_on` / `ended_on`: texto `YYYY-MM-DD`, inclusivos. `ended_on` nulo = período abierto. Sin solapes por equipo. Ninguna de las dos fechas puede ser futura, medida con `todayInChile()`.
- **No** colgar la exclusión de `accountableProviderTransactionsWhere`, `buildLoadWhere` ni `countedOrderLineWhere` si eso la mete en pagos, conciliaciones o listados. Usa variantes opt-in o un parámetro explícito.
- **No tocar:** cuadratura, pagos, conciliaciones (la lista «Payment / reconciliation» de la Task 14), `copec-sync`, `visionlink-sync`, la matriz de cobertura de fuentes, `operational_status`, faena, contrato ni Mantención (`lib/services/mantencion/*`).
- Permiso nuevo `flota:personal_use`, «Marcar uso personal de equipos», para los roles `administrador`, `jefe_mantencion` y `jefa_chome`.
- Textos de interfaz exactos:
  - bloque «Uso personal»
  - botón «Marcar uso personal»
  - insignia «En uso personal»
  - marca de registro «Uso personal»
  - nota de Control operacional «Excluye N días de uso personal» (singular «1 día»)
  - nota del Panel «Excluye uso personal»
  - período abierto «(en curso)»
- Reglas de `AGENTS.md`:
  - migración con `db:generate` + checksum + `db:verify-migrations`;
  - `Field`, `DatePicker`, `Sheet`, `Badge` con tokens `-ink`;
  - `formatDate`;
  - fuente de verdad en `lib/` + `app/`.

## Review Focus

1. **Período abierto** (`ended_on` nulo): excluye desde `started_on` hasta hoy en todas las consultas, y en un TCT del mes en curso o de un mes pasado posterior al inicio.
2. **Borde horario**: una carga Copec a las 22:30 hora de Chile del último día del período (`…T01:30:00Z` del día siguiente) se excluye. Una de las 00:30 del día siguiente, no.
3. **Cuadre**: en un mes con costo C y uso personal P, Control operacional y Costo por contrato muestran C − P, y contratos + «Sin contrato» + «Por repartir» suman C − P.
4. **Quitar un período** devuelve todas las cifras a como estaban: no queda nada cacheado.
5. **Pagos intactos**: los totales de cuadratura y pagos de un mes son los mismos con y sin períodos marcados.

Cada punto tiene su prueba en la tarea que es dueña del código: punto 1 en las Tasks 2 y 6, punto 2 en la Task 6, punto 3 en la Task 7, punto 4 en la Task 3 y punto 5 en la Task 14.

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `db/schema/fleet-personal-use.ts` (nuevo; exportado en `db/schema/index.ts`) | tabla `fuel_vehicle_personal_use_periods` |
| `db/migrations/NNNN_*.sql` (generada) + trigger anexado | tabla, chequeos y trigger contra solapes |
| `lib/fleet/personal-use.ts` (nuevo) | tipos y helpers en memoria; validación |
| `lib/fleet/personal-use-sql.ts` (nuevo) | predicados SQL compartidos |
| `lib/services/fleet-personal-use.ts` (nuevo) | listar, cargar por lote, crear, editar, quitar (con auditoría) |
| `modules/flota/manifest.ts` | permiso y roles |
| `app/(app)/flota/actions.ts` | acciones guardar y quitar |
| `app/(app)/flota/[id]/flota/vehicle-personal-use-card.tsx`, `personal-use-sheet.tsx` (nuevos), `page.tsx`, `app/(app)/flota/[id]/_ficha/ficha-chrome.tsx` | interfaz |
| consultas de las Tasks 6–13 | aplicar la exclusión |
| `lib/__tests__/personal-use-coverage.test.ts` (nuevo) | guarda estática |
| `e2e/uso-personal.spec.ts` (nuevo) | recorrido completo |

---

### Task 1: Tabla de períodos y migración

**Files:**
- Create: `db/schema/fleet-personal-use.ts`; Modify: `db/schema/index.ts`
- Create: migración generada en `db/migrations/` + `meta/_sql-checksums.json`
- Test: `lib/__tests__/personal-use-schema-pglite.test.ts`

**Interfaces:**
- Produces: `fuelVehiclePersonalUsePeriods` (Drizzle). Columnas:
  - `id` text pk
  - `vehicleId` (`vehicle_id`, FK `fuel_vehicles.id` on delete cascade, not null)
  - `startedOn` (`started_on` text not null)
  - `endedOn` (`ended_on` text null)
  - `note` (text null)
  - `createdByUserId` (`created_by_user_id`, FK `users.id` set null)
  - `createdAt`, `updatedAt` (timestamptz default now)
- Chequeos e índices:
  - CHECK `ended_on IS NULL OR ended_on >= started_on`
  - CHECK de formato `^\d{4}-\d{2}-\d{2}$` en ambas fechas
  - índice único parcial «una abierta por equipo»
  - índice `(vehicle_id, started_on)`

- [ ] **Step 1: Escribir la prueba PGlite.** `rechaza solapes` inserta dos períodos solapados del mismo equipo y espera un error con `PERSONAL_USE_OVERLAP`. `rechaza fin antes del inicio` espera la violación del CHECK. `permite períodos contiguos` usa 01-10 → 05-10 y 06-10 → null y no espera error. `permite el mismo rango en otro equipo` no espera error. Sigue el arranque de `lib/__tests__/fleet-transfers-pglite.test.ts`.
- [ ] **Step 2:** `npm run test:pglite -- lib/__tests__/personal-use-schema-pglite.test.ts`. Debe FALLAR (la tabla no existe).
- [ ] **Step 3:** Escribir el schema, correr `npm run db:generate` y anexar a la migración, separado por `--> statement-breakpoint`, un trigger `BEFORE INSERT OR UPDATE` idempotente (`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS`). El trigger lanza `RAISE EXCEPTION 'PERSONAL_USE_OVERLAP: …'` si existe otra fila del mismo `vehicle_id` con `started_on <= coalesce(NEW.ended_on,'9999-12-31') AND coalesce(ended_on,'9999-12-31') >= NEW.started_on` e `id <> NEW.id`. El patrón está en `db/migrations/0391_round_big_bertha.sql:99-135`.
- [ ] **Step 4:** `node scripts/verify-migration-chain.mjs --update-checksums && npm run db:verify-migrations`, y `npm run db:generate` debe responder «No schema changes». Después, la prueba del Step 1 debe PASAR.
- [ ] **Step 5:** Commit `feat(flota): tabla de períodos de uso personal`.

### Task 2: Helpers de dominio (memoria y SQL)

**Files:**
- Create: `lib/fleet/personal-use.ts`, `lib/fleet/personal-use-sql.ts`
- Test: `lib/fleet/__tests__/personal-use.test.ts` (fast), `lib/__tests__/personal-use-sql-pglite.test.ts`

**Interfaces:**
- Consumes: la tabla de la Task 1.
- Produces, en `personal-use.ts`:
  - `type PersonalUsePeriod = { id: string; vehicleId: string; startedOn: string; endedOn: string | null; note: string | null }`
  - `type PersonalUseIndex = ReadonlyMap<string, readonly PersonalUsePeriod[]>`, por `vehicleId`
  - `indexPersonalUse(periods: readonly PersonalUsePeriod[]): PersonalUseIndex`
  - `isPersonalUseDay(index: PersonalUseIndex, vehicleId: string, day: string, today?: string): boolean`. Un período abierto cubre hasta `today ?? todayInChile()`.
  - `personalUseDaysIn(index, vehicleId, from: string, to: string, today?: string): number`. Días solapados, ambos extremos inclusivos.
  - `keptFraction(index, vehicleId, from, to, today?): number` = `1 - personalUseDaysIn / días(from..to)`, acotado a [0, 1].
  - `validatePersonalUsePeriod(input: { startedOn: string; endedOn: string | null }, others: readonly PersonalUsePeriod[], today: string): string | null`. Devuelve un mensaje en español o `null`. Casos: fecha inválida, inicio futuro, fin futuro, fin anterior al inicio, solape con otro período (el mensaje nombra sus fechas con `formatDate`).
- Produces, en `personal-use-sql.ts`:
  - `personalUseOnDaySql(vehicleId: AnyColumn | SQL, day: SQL): SQL<boolean>`: `exists(...)` correlacionado. La columna se califica igual que en `lib/fleet/stays-sql.ts:27-37`.
  - `notPersonalUseOnDaySql(vehicleId, day): SQL<boolean>`.
  - `personalUseDaysInSql(vehicleId, from: SQL, to: SQL): SQL<number>`: suma de `greatest(0, least(to, coalesce(ended_on, to)) - greatest(from, started_on) + 1)` sobre los períodos del equipo, con fechas casteadas a `date`.
  - `keptFractionSql(vehicleId, from: SQL, to: SQL): SQL<number>`: `1 - personalUseDaysInSql / ((to::date - from::date) + 1)`. Devuelve `1` si `vehicleId` es nulo.

- [ ] **Step 1: Pruebas unitarias.**
  - `isPersonalUseDay` es verdadero en `started_on`, en `ended_on` y en un día intermedio; falso el día anterior y el siguiente. En un período abierto es verdadero hasta `today` y falso después.
  - `personalUseDaysIn` sobre 2026-10-01..2026-10-31 con un período 2026-10-10..2026-10-19 da `10`, y `keptFraction` da `21/31`.
  - `validatePersonalUsePeriod` devuelve un mensaje para cada caso de error y `null` para un período válido contiguo a otro.
- [ ] **Step 2: Prueba PGlite.** Con un equipo con período 2026-10-10..2026-10-19:
  - `select personalUseOnDaySql(v.id, '2026-10-19')` → true; `'2026-10-20'` → false.
  - `keptFractionSql(v.id, '2026-10-01', '2026-10-31')` ≈ `21/31`.
  - `keptFractionSql(null, …)` → 1.
  - Con un período abierto desde 2026-10-25: `personalUseDaysInSql(v.id,'2026-10-01','2026-10-31')` → 7.
- [ ] **Step 3:** Correr ambas pruebas. Deben FALLAR.
- [ ] **Step 4:** Implementar los dos archivos.
- [ ] **Step 5:** `npx vitest run lib/fleet/__tests__/personal-use.test.ts` y `npm run test:pglite -- lib/__tests__/personal-use-sql-pglite.test.ts`. Deben PASAR.
- [ ] **Step 6:** Commit `feat(flota): helpers de uso personal`.

### Task 3: Servicio con auditoría

**Files:**
- Create: `lib/services/fleet-personal-use.ts`
- Test: `lib/__tests__/fleet-personal-use-pglite.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2; `recordAudit` (`lib/audit.ts:71`).
- Produces:
  - `type Actor = { userId: string; email: string | null }`
  - `type PersonalUseResult = { ok: true; id: string } | { ok: false; message: string }`
  - `listPersonalUsePeriods(vehicleId: string): Promise<PersonalUsePeriod[]>`, ordenado por `startedOn` desc.
  - `loadPersonalUseIndex(vehicleIds: readonly string[]): Promise<PersonalUseIndex>`.
  - `createPersonalUsePeriod(actor, input: { vehicleId: string; startedOn: string; endedOn: string | null; note: string | null }): Promise<PersonalUseResult>`.
  - `updatePersonalUsePeriod(actor, id: string, input: { startedOn; endedOn; note }): Promise<PersonalUseResult>`.
  - `deletePersonalUsePeriod(actor, id: string): Promise<PersonalUseResult>`.
  - Cada escritura: una transacción, un `SELECT … FOR UPDATE` de los períodos del equipo, `validatePersonalUsePeriod` contra los demás y un `recordAudit` con `entityType: "fuel_vehicle_personal_use"`, `entityId: <id>`, `oldState`/`newState` JSON y `action` `create|update|delete`. Un error `PERSONAL_USE_OVERLAP` del trigger se traduce al mismo mensaje de solape.

- [ ] **Step 1: Pruebas.**
  - crear válido → ok y una fila en `audit_log`;
  - crear solapado → `ok:false` con un mensaje que nombra las fechas;
  - editar cerrando un abierto → ok y auditoría con el estado anterior;
  - quitar → la fila desaparece, queda auditoría `delete` y `loadPersonalUseIndex` ya no lo trae (Review Focus 4);
  - fecha futura → `ok:false`.
- [ ] **Step 2:** `npm run test:pglite -- lib/__tests__/fleet-personal-use-pglite.test.ts`. Debe FALLAR.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** La prueba debe PASAR.
- [ ] **Step 5:** Commit `feat(flota): servicio de períodos de uso personal`.

### Task 4: Permiso y acciones

**Files:**
- Modify: `modules/flota/manifest.ts` (lista, `permissionMeta` `{ id: "p-flot-personal-use", description: "Marcar uso personal de equipos" }` y los tres roles), `app/(app)/flota/actions.ts`
- Test: `lib/__tests__/flota-personal-use-actions.test.ts`, siguiendo el estilo de `lib/__tests__/flota-actions.test.ts` y `app/(app)/flota/traslados/actions.test.ts`. Revisa también las pruebas de paridad de permisos (`modules/**/__tests__`) y actualízalas si listan permisos.

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `savePersonalUsePeriodAction(_prev: ActionState, formData: FormData): Promise<ActionState>`. Campos: `vehicleId`, `id` (vacío = crear), `startedOn`, `endedOn` (vacío = abierto) y `note`.
  - `deletePersonalUsePeriodAction(id: string): Promise<ActionState>`.
  - Las dos hacen `guardPermission("flota:personal_use")` y luego `canAccessWorksite(session, vehicle.worksiteId)`. Si falla: «No puedes gestionar vehículos de esta faena».
  - Revalidan `/flota`, la ficha (`revalidateVehicleFicha`), `/control-operacional`, `/combustibles`, `/dashboard` y `/analitica`.

- [ ] **Step 1: Pruebas.** Sin permiso → error de permiso. Faena ajena → el mensaje de faena. Datos válidos → `ok:true` y llama al servicio. Fecha inválida → `fieldErrors.startedOn`.
- [ ] **Step 2:** Correr la prueba. Debe FALLAR.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** La prueba debe PASAR. `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(flota): permiso y acciones de uso personal`.

### Task 5: Ficha del equipo

**Files:**
- Create: `app/(app)/flota/[id]/flota/vehicle-personal-use-card.tsx`, `personal-use-sheet.tsx`
- Modify: `app/(app)/flota/[id]/flota/page.tsx`, para cargar `listPersonalUsePeriods` y `canMarkPersonalUse = can(session,"flota:personal_use") && canAccessWorksite(...)`, y montar la tarjeta junto a `VehicleContractCard`.
- Modify: `app/(app)/flota/[id]/_ficha/ficha-chrome.tsx`, para la insignia «En uso personal» cuando hay un período abierto.
- Test: `app/(app)/flota/[id]/flota/vehicle-personal-use-card.test.tsx`

**Interfaces:**
- Consumes: Tasks 3-4.
- Produces: `VehiclePersonalUseCard({ vehicleId, periods, canMark, today }: { vehicleId: string; periods: PersonalUsePeriod[]; canMark: boolean; today: string })`.
- El `Sheet` usa `useActionState(savePersonalUsePeriodAction)`, dos `DatePicker` («Desde», y «Hasta», opcional, con la ayuda «Déjalo vacío si el equipo aún no vuelve»), `Field` para la nota y `toast` al guardar.
- «Quitar» usa `ConfirmDialog` + `useOperation(deletePersonalUsePeriodAction)`.
- Cada fila: «12-10-2026 → 19-10-2026», o «03-11-2026 → (en curso)», con la nota y los botones «Editar · Quitar» si `canMark`.
- Sin períodos: estado vacío con `EmptyState`, del tipo «Este equipo no tiene uso personal marcado».

- [ ] **Step 1: Pruebas.**
  - lista dos períodos con el formato exacto;
  - sin `canMark` no hay botones;
  - un período abierto muestra «(en curso)»;
  - sin períodos se ve el estado vacío;
  - la insignia de `ficha-chrome` aparece sólo con un período abierto.
- [ ] **Step 2:** Correr las pruebas. Deben FALLAR.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Las pruebas deben PASAR, y `npm run lint` también.
- [ ] **Step 5:** Commit `feat(flota): marcar uso personal desde la ficha`.

### Task 6: Combustible facturado (Control operacional y por día)

**Files:**
- Create: `lib/combustibles/personal-use-fuel-sql.ts`
- Modify: `lib/combustibles/control/queries/asset-fuel-summary.ts`. Cambia `billedTransactionsWhere` (L77), `getFuelBilledByVehicleDay` (L101) y `getAssetFuelSummary` (L133): sus litros y su rendimiento medio (L146-164) y el ralentí (L205-213, vía la Task 12).
- Test: `lib/__tests__/asset-fuel-summary-personal-use-pglite.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces, en `personal-use-fuel-sql.ts`, para la tabla `fuel_provider_transactions` (alias `t`):
  - `providerTxKeptWhereSql(t)`: `granularity = 'period_aggregate' OR notPersonalUseOnDaySql(t.vehicleId, to_char(isoTextDaySql(t.occurredAt),'YYYY-MM-DD'))`.
  - `providerTxKeptAmountSql(t)` y `providerTxKeptQuantitySql(t)`: `CASE WHEN granularity='period_aggregate' THEN amount * keptFractionSql(t.vehicleId, <día 1 del mes>, <último día del mes>) ELSE amount END`. Ídem con `quantity`. El mes sale de `left(t.occurred_at,7)`, porque el agregado guarda `YYYY-MM-01`.
- `billedTransactionsWhere` agrega `providerTxKeptWhereSql`. Las sumas de `amount` en las dos funciones pasan a `providerTxKeptAmountSql`. Los litros de cargas en terreno de `getAssetFuelSummary` agregan `notPersonalUseOnDaySql(fuel_equipment_loads.vehicle_id, to_char(chileDateSql(occurred_at),'YYYY-MM-DD'))`.

- [ ] **Step 1: Pruebas.** Para un equipo en octubre:
  - una transacción Copec el 2026-10-15 de $100 dentro del período → excluida;
  - una de $50 el 2026-10-25 → cuenta;
  - una a las `2026-10-20T01:30:00Z` (22:30 del 19 en Chile, último día del período) → excluida;
  - una a las `2026-10-20T03:30:00Z` (00:30 del 20) → cuenta (Review Focus 2);
  - un TCT `period_aggregate` de noviembre de $310 con período 2026-11-01..2026-11-10 → cuenta $210;
  - un período abierto desde 2026-11-21, consultado con hoy = 2026-11-30 → el TCT de noviembre cuenta $310 × 20/30 (Review Focus 1);
  - `getFuelBilledByVehicleDay` devuelve los mismos montos por día.
- [ ] **Step 2:** Correr la prueba. Debe FALLAR.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** La prueba debe PASAR. `npm run test:pglite -- lib/__tests__/contract-costs-pglite.test.ts` debe seguir verde.
- [ ] **Step 5:** Commit `feat(combustibles): el combustible facturado excluye el uso personal`.

### Task 7: Compras por OC y cuadre por contrato

**Files:**
- Modify: `lib/services/purchasing-module/vehicle-purchase-summary.ts`, en `countedOrderLineWhere` (L53). Sus únicos llamadores son `getVehiclePurchaseSummary` y `getVehiclePurchaseByDay`; lo usan sólo Control operacional y Costo por contrato.
- Test: `lib/__tests__/vehicle-purchase-personal-use-pglite.test.ts`; agregar un caso a `lib/__tests__/contract-costs-pglite.test.ts`

**Interfaces:**
- Consumes: Task 2.
- `countedOrderLineWhere` agrega `notPersonalUseOnDaySql(purchase_request_items.vehicle_id, to_char(isoTextDaySql(purchase_orders.issued_at),'YYYY-MM-DD'))`. Una línea sin equipo queda igual. `getWorksitePurchasesWithoutVehicle` no cambia.

- [ ] **Step 1: Pruebas.**
  - Una OC emitida dentro del período no cuenta; una emitida el día siguiente, sí.
  - En `contract-costs`: un equipo con contrato, costo C en el mes (combustible + OC + un TCT) y un período P. La suma de contratos + «Sin contrato» + «Por repartir» es C − P (Review Focus 3).
- [ ] **Step 2:** Correr la prueba. Debe FALLAR.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Las pruebas deben PASAR.
- [ ] **Step 5:** Commit `feat(compras): las OC del uso personal no cuentan en costos`.

### Task 8: Avance GPS sin los días de uso personal

**Files:**
- Modify: `lib/combustibles/meter-series.ts` (L125, L179)
- Modify: `lib/services/operational-control.ts`, en `computeGpsAdvance` (L258) y su uso (L610)
- Modify: `lib/services/fleet.ts`, en el costo por km y hora (L396-401)
- Modify: `lib/services/fleet-gps-indicators.ts`: `buildGpsUsage` (L289-380), `getGpsDrivingIndicators` (L678) y `getGpsUsageIndicators` (L432)
- Test: `lib/combustibles/__tests__/meter-series.test.ts` (agregar casos), `lib/__tests__/fleet-gps-indicators-personal-use-pglite.test.ts`

**Interfaces:**
- Consumes: Tasks 2-3 (`loadPersonalUseIndex`, `isPersonalUseDay`).
- Produces: `meterSeriesAdvance(points, maxPerDay, isExcludedDay?: (day: string) => boolean): MeterSeriesAdvance`.
  - Descarta el segmento cuyo `to` cae (en día de Chile) en un día excluido.
  - **No** quita lecturas: si las quitara, el par que salta el hueco contaría los km personales.
  - Sin `isExcludedDay`, el comportamiento es el actual.
- `computeGpsAdvance` recibe `isExcludedDay` construido con el índice del lote de equipos.
- `buildGpsUsage` filtra los `{day, advance}` de `dailyAdvanceFromSeries` con `isPersonalUseDay`.
- `getGpsDrivingIndicators` agrega `notPersonalUseOnDaySql(fleet_gps_trips.vehicle_id, to_char(chileDay(started_at),'YYYY-MM-DD'))`.
- `lib/services/mantencion/*` **no** se toca.

- [ ] **Step 1: Pruebas.**
  - Una serie con lecturas los días 1, 5, 10 y 15 y los días 6-10 excluidos: el avance omite exactamente el segmento 5→10. Sin función, el avance es el actual.
  - En PGlite, los km de uso GPS de un equipo con período bajan exactamente en el avance de esos días, y los viajes del período no suman.
- [ ] **Step 2:** Correr las pruebas. Deben FALLAR.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Las pruebas deben PASAR, y también `npx vitest run lib/combustibles/__tests__/meter-series.test.ts`.
- [ ] **Step 5:** Commit `feat(flota): km y horas de gestión sin el uso personal`.

### Task 9: Nota en Control operacional y su Excel

**Files:**
- Modify: `lib/services/operational-control.ts`. Agrega `personalUseDays: number` a cada activo, calculado con `personalUseDaysIn` sobre el período consultado.
- Modify: `app/(app)/control-operacional/operational-assets-table.tsx` (L130-140, L382-395): nota discreta «Excluye N días de uso personal», con tooltip «Su combustible, compras, litros y km de esos días no se suman». Sólo si N > 0.
- Modify: `lib/operational-control/export-columns.ts` y `app/(app)/control-operacional/actions.ts`: columna «Días de uso personal excluidos».
- Test: `app/(app)/control-operacional/operational-assets-table.test.tsx` y `lib/__tests__/operational-control-export-columns.test.ts` (un caso nuevo en cada uno).

**Interfaces:** Consumes: Tasks 3, 6, 7 y 8.

- [ ] **Step 1: Pruebas.** Con N = 3 la nota dice «Excluye 3 días de uso personal», con N = 1 dice «Excluye 1 día de uso personal» y con N = 0 no hay nota. El Excel trae la columna con el número.
- [ ] **Step 2:** Correr las pruebas. Deben FALLAR.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Las pruebas deben PASAR.
- [ ] **Step 5:** Commit `feat(control-operacional): aviso de días de uso personal excluidos`.

### Task 10: Flota, Analítica, Inicio y Consumo

**Files:**
- Modify: `lib/services/fleet.ts`: gasto 12 meses (L182-194, `providerWhere` L163-168) y totales de página (L545-556).
- Modify: `lib/services/analytics-module/dashboard.ts`: `fuelWhereFor` L184 y sumas L201-223.
- Modify: `lib/services/dashboard-fuel.ts`: `getFuelMonthlyTrend` L93.
- Modify: `lib/combustibles/fuel-control-overview.ts`: `getFuelControlOverview` L44 y `getTaeOverview` L115.
- Modify: `lib/combustibles/consumption-dashboard.ts`: L121, L246, L286, L332.
- Modify: `lib/combustibles/operations-dashboard.ts`: `getOperationsSummary` L76, sobre `fuel_operation_records` (`fecha`).
- Test: `lib/__tests__/fuel-management-views-personal-use-pglite.test.ts`

**Interfaces:**
- Consumes: Tasks 2 y 6.
- `fuel_provider_transactions`: `providerTxKeptWhereSql` / `providerTxKeptAmountSql` / `providerTxKeptQuantitySql`.
- `fuel_consumption_records`: cada `sum(monto)` y `sum(cantidad_unidad)` se multiplica por `keptFractionSql(vehicle_id, periodo_desde, periodo_hasta)`. Con `vehicle_id` nulo la fracción es 1.
- `fuel_loads` (`load_date`) y `fuel_operation_records` (`fecha`): `notPersonalUseOnDaySql`.

- [ ] **Step 1: Pruebas.** Con un equipo con período y datos de cada fuente, cada función devuelve el total sin la parte del período:
  - Flota 12 meses;
  - top de Analítica;
  - tendencia de Inicio;
  - Consumo: un registro de 1-31 de octubre con 10 días personales cuenta 21/31 de su monto;
  - resumen de control;
  - TAE;
  - operaciones.
  Un registro sin `vehicle_id` cuenta completo.
- [ ] **Step 2:** Correr la prueba. Debe FALLAR.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** La prueba debe PASAR.
- [ ] **Step 5:** Commit `feat(combustibles): vistas de gestión sin el uso personal`.

### Task 11: Litros de cargas en terreno

**Files:**
- Modify: `lib/combustibles/control/filters.ts`. Agrega, al lado de `buildLoadWhere` (L161), `buildManagementLoadWhere(session, filters)` = `buildLoadWhere(...)` + `notPersonalUseOnDaySql(fuel_equipment_loads.vehicle_id, to_char(chileDateSql(occurred_at),'YYYY-MM-DD'))`. `buildLoadWhere` **no** cambia: la usan la cola de revisión y los listados.
- Usar `buildManagementLoadWhere` en:
  - `panel/queries.ts`: `getPanelFigures` L59, `hasMeasuredPerformance` L138, `getMyEquipmentRanking` L253;
  - `indicators/queries.ts`: L50, L126, L154;
  - `control/queries/overview.ts`: L39, L72, L96, L137;
  - `control/queries/worse-than-model.ts` L28;
  - `equipment/get-equipment-file.ts`: `getLitersByMonth` L340 y `getPerformance` L258;
  - `control/queries/idle-comparison.ts` (la parte de cargas);
  - `lib/combustibles/tae-dashboard.ts` `getTaeGroupedTotals` L29, con `fuel_tae_submissions` y el día de Chile de `loaded_at`.
- Modify: el componente del Panel (`app/(app)/combustibles/` page / panel) para mostrar la nota «Excluye uso personal» cuando `personalUseDaysInPeriod > 0`, valor que expone `getPanelFigures`. La tira de cinco pasos no cambia.
- Test: `lib/__tests__/fuel-liters-personal-use-pglite.test.ts`, y el test del Panel para la nota.

**Interfaces:** Consumes: Task 2. Produces: `buildManagementLoadWhere(session, filters): SQL`.

- [ ] **Step 1: Pruebas.** Los litros de la faena en el Panel y en los indicadores bajan exactamente en los litros de las cargas del período. `getPaymentActivity` (`panel/queries.ts` L159) no cambia. La nota aparece sólo cuando hay días excluidos.
- [ ] **Step 2:** Correr la prueba. Debe FALLAR.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** La prueba debe PASAR.
- [ ] **Step 5:** Commit `feat(combustibles): litros de gestión sin el uso personal`.

### Task 12: Rendimiento, ralentí y anomalías

**Files:**
- Modify: `lib/combustibles/control/queries/performance.ts`: L40, L72, L132 (incluida la subconsulta de L176), L192 y L301. También `lib/services/fleet.ts` `getWorkOrderConsumptionImpact` L615 y `lib/combustibles/control/queries/meter-rates.ts` `getMeterRateSeries` L53, que filtra los segmentos con el mismo `isExcludedDay` de la Task 8.
- Modify: `lib/combustibles/control/queries/idle.ts` `dailyTelemetry` (L43). Pasa a recibir un parámetro **obligatorio** `personalUse: "exclude" | "include"`, para que el compilador obligue a decidir en cada llamador:
  - `"exclude"`: `idle.ts` (L130-197), `asset-fuel-summary.ts`, `idle-comparison.ts` y `get-equipment-file.ts` `getIdle`;
  - `"include"`: `coverage-matrix-data.ts:94` y `visionlink-sync`, si la usa.
- Modify: `lib/combustibles/anomaly-detector.ts`:
  - `detectConsumptionWhileInactive` (L546; cargas y transacciones en L572-593), `detectUnusualSupplier` (L618) y `getOperationPerformanceObservations` (L251): omiten las filas cuyo día cae en un período;
  - `detectSharpConsumptionChange` (L423): omite los registros cuyo período se solapa con uno de uso personal;
  - el medidor regresivo (L758) **no** cambia, porque es un error de datos.
- Test: `lib/__tests__/performance-personal-use-pglite.test.ts`, y un caso en las pruebas existentes del detector.

**Interfaces:**
- Consumes: Task 2.
- Produces: `performanceTaintedByPersonalUseSql(load = fuel_equipment_loads): SQL<boolean>`, en `lib/combustibles/personal-use-fuel-sql.ts`. Es verdadero si existe un período del equipo con algún día entre el día de la carga contable anterior y el día de esta carga, ambos inclusivos. Cubre las cargas dentro del período y la **primera después**.
  - Carga anterior: `(select max(chileDateSql(l2.occurred_at)) from fuel_equipment_loads l2 where l2.vehicle_id = l.vehicle_id and l2.occurred_at < l.occurred_at and countableLoadSql(l2))`.
  - Si no hay carga anterior, se usa el día de la propia carga.
- Las sumas y promedios de `performance_value` agregan `NOT performanceTaintedByPersonalUseSql(...)` dentro del `FILTER`.

- [ ] **Step 1: Pruebas.**
  - Cargas los días 5, 12 (dentro de un período 10-15) y 18: el rendimiento excluye la del 12 y la del 18, e incluye la del 5.
  - Una carga posterior a la del 18 vuelve a contar.
  - `dailyTelemetry(..., "exclude")` omite los días del período y `"include"` no.
  - El detector no abre «consumo estando inactivo» ni «proveedor inusual» por una carga dentro del período.
- [ ] **Step 2:** Correr las pruebas. Deben FALLAR.
- [ ] **Step 3:** Implementar. `npm run typecheck` debe guiar los llamadores de `dailyTelemetry`.
- [ ] **Step 4:** Las pruebas deben PASAR.
- [ ] **Step 5:** Commit `feat(combustibles): rendimiento, ralentí y anomalías sin el uso personal`.

### Task 13: Marca «Uso personal» en los registros

**Files:**
- Modify: `lib/combustibles/fuel-log.ts` (bitácora), `lib/combustibles/control/review-queue.ts` («Por revisar») y `lib/combustibles/equipment/get-equipment-file.ts` `getLoads` (L197). Cada fila agrega `personalUse: boolean` vía `personalUseOnDaySql`.
- Modify: sus componentes de lista. Si `personalUse`, muestran un `Badge` «Uso personal» con un token `-ink`. **No** se ocultan filas.
- Test: las pruebas de componente existentes de esas listas, con un caso nuevo cada una.

**Interfaces:** Consumes: Task 2.

- [ ] **Step 1: Pruebas.** Una fila con `personalUse: true` muestra «Uso personal». El total de filas no cambia.
- [ ] **Step 2:** Correr las pruebas. Deben FALLAR.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Las pruebas deben PASAR.
- [ ] **Step 5:** Commit `feat(combustibles): marca de uso personal en registros`.

### Task 14: Guarda estática, E2E y verificación

**Files:**
- Create: `lib/__tests__/personal-use-coverage.test.ts`, con el estilo de `lib/__tests__/fleet-relocation-callers.test.ts`.
- Create: `e2e/uso-personal.spec.ts`.
- Create: `qa/reports/uso-personal-equipos-<fecha>.md`.

- [ ] **Step 1: Guarda estática.**
  - Una lista `MANAGEMENT_FILES` con cada archivo tocado en las Tasks 6-12. Cada uno debe importar desde `@/lib/fleet/personal-use-sql`, `@/lib/fleet/personal-use`, `@/lib/combustibles/personal-use-fuel-sql` o `buildManagementLoadWhere`.
  - Una lista `PAYMENT_FILES` que **no** debe importarlos: `fuel-reconciliation.ts`, `fuel-dte-reconciliation.ts`, `control/queries/reconciliation.ts`, `reconciliation-summary.ts`, `tae-copec-reconciliation.ts`, `payables-summary.ts`, `statements-preview.ts`, `fuel-provider-ledger.ts`, `copec-sync.ts`, `provider-pending-items.ts`, `coverage-notice-data.ts`, `sources-status.ts`, `coverage-matrix-data.ts`, `fuel-cycle.ts`, `open-period.ts`, `services/operational-control-sources.ts`, `dte-portal/reconciliation.ts`, `dte-portal/folio-match.ts`, `purchasing-module/reconciliation-overview.ts`, `app/(app)/combustibles/pagos/invoice-data.ts` y todo `lib/services/mantencion/`.
- [ ] **Step 2: Pagos intactos (Review Focus 5).** Prueba PGlite: los totales de `payables-summary` y de la conciliación de un mes son iguales antes y después de marcar un período.
- [ ] **Step 3: E2E.**
  1. Entrar como administrador y abrir la ficha de un equipo sembrado, con cargas y una OC en octubre.
  2. Marcar un uso personal del 10 al 19 de octubre.
  3. En Control operacional, para octubre: el costo bajó en lo sembrado y aparece «Excluye 10 días de uso personal».
  4. Quitar el período: el costo vuelve.
  5. Un usuario sin el permiso no ve «Marcar uso personal».
  Usa `getByRole` y los helpers de `e2e/helpers.ts`, con base y puerto propios (ver la nota de `AGENTS.md` sobre las listas duplicadas en móvil).
- [ ] **Step 4: Puertas.**
  - `npm run typecheck`
  - `npm run lint`
  - `npm run check:secrets`
  - `npm run test:fast`
  - `npm run test:pglite`
  - `npm run db:verify-migrations`
  - `npm run test:e2e` (worktree propio, base y puerto propios)
- [ ] **Step 5: Navegador sobre `bodega_dev`.** Primero migrar y sembrar un equipo `QA_` con cargas, una OC y un TCT en el período. Luego recorrer:
  - ficha;
  - Control operacional (nota y Excel);
  - Costo por contrato (cuadre);
  - Panel de combustible (nota);
  - bitácora (marca);
  - Mantención (sin cambio).
  Revisar la consola y la red. Dejar el informe en `qa/reports/` con lo verificado y lo no recorrido.
- [ ] **Step 6:** Commit `test(flota): cobertura y recorrido del uso personal`.
