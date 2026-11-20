# Turnos de operación y ralentí por operador — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar en la plataforma los turnos de operación de los equipos y calcular el % de ralentí por turno, por operador y por equipo con los tramos por hora de VisionLink.

**Architecture:** Tablas nuevas de turnos, telemetría por hora, constancia de consulta y marcas de día. Un módulo puro (`lib/fleet/shifts/`) hace todo el cálculo sobre filas por hora; un sync nuevo de VisionLink las llena (cron diario de 14 días + cron liviano cada hora); un servicio aplica alcance por faena, cruces y auditoría; la pantalla `/flota/turnos` muestra tres vistas.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Drizzle + PostgreSQL, Vitest (`test:fast` / `test:pglite`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-turnos-ralenti-design.md` — léela antes de cualquier tarea; este plan no repite su porqué.

## Global Constraints

- Leer `AGENTS.md` y, para rutas/acciones de Next, `node_modules/next/dist/docs/` antes de escribir código.
- Trabajar en un worktree desechable (`superpowers:using-git-worktrees`); `test:e2e` borra `.next` y la base/puerto E2E son compartidos: base y puerto propios.
- Migraciones sólo con `npm run db:generate`; nunca editar `meta/_journal.json` ni un `.sql` ya generado; SQL propio se agrega al final del generado, idempotente, con `--> statement-breakpoint`; luego `node scripts/verify-migration-chain.mjs --update-checksums` y `npm run db:generate` debe responder «No schema changes».
- Fechas civiles como texto `YYYY-MM-DD`; hoy = `todayInChile()`; nunca `new Date().toISOString().slice(0,10)`.
- La faena de un equipo nunca se escribe: se lee con `stayWorksiteOnDaySql` (`lib/fleet/stays-sql.ts`).
- Constantes (en `lib/fleet/shifts/constants.ts`): `IDLE_TARGET_DEFAULT = 0.30`, `MIN_ENGINE_HOURS = 0.5`, `UNASSIGNED_WARNING_HOURS = 1`, `KNOWN_HOUR_MARGIN_MS = 3_600_000`, `DAILY_LOOKBACK_DAYS = 14`, `HOURLY_LOOKBACK_DAYS = 2`, `VISIONLINK_MAKE = "CAT"`, `SEGMENT_WINDOW_DAYS = 28`.
- Turnos predefinidos, rótulos exactos: «Mañana 06–14» (6,14), «Tarde 14–22» (14,22), «Noche 22–06» (22,6), «Día 12 h 06–18» (6,18), «Noche 12 h 18–06» (18,6), «Otro horario».
- Estados del turno, rótulos exactos y en este orden de evaluación: «Sin telemetría», «Pendiente de datos», «Sin señal», «Sin uso», «Sin dato de ralentí», «Sobre meta», «En meta».
- Permisos: `flota:view_shifts` (administrador, jefa_chome, jefe_mantencion, admin_contrato) y `flota:manage_shifts` (administrador, admin_contrato).
- UI: `PageHeader` + `PageContainer`, `DataTable`, `DatePicker`, `Field`, `Combobox`, `Badge`, `SummaryBar` (≤ 4 cifras), `EmptyState`, tokens `-ink`; nada de `uppercase` ni `text-[10px]`; vista en la URL con `router.replace(url, { scroll: false })`.
- Nunca imprimir credenciales de VisionLink; nunca commitear el JSON exportado de la página original (trae nombres de personas).

## Review Focus

- Un turno nocturno del último día del rango («hasta») cuenta entero en el ranking, aunque sus horas caigan al día siguiente → prueba en Task 7.
- Editar un turno no choca consigo mismo, pero sí con otro turno del equipo o del operador nuevos → prueba en Task 6.
- Un turno anulado libera sus horas: se puede registrar otro en el mismo horario → prueba en Task 6.
- Un equipo trasladado a mitad del período: un usuario de una faena sólo ve los turnos de los días en que el equipo estuvo en su faena → prueba en Task 7.
- Tramos repetidos entre páginas de VisionLink (mismo `startStateUtc` y tipo) no se suman dos veces → prueba en Task 3.

---

### Task 1: Esquema, migración y rama

**Files:**
- Create: `db/schema/fleet-shifts.ts`
- Modify: `db/schema/index.ts` (exportar el archivo nuevo)
- Create (generado): `db/migrations/0396_*.sql` + `meta/*` + `db/migrations/meta/_sql-checksums.json`
- Test: `lib/fleet/shifts/schema-pglite.test.ts`

**Interfaces:**
- Produces (Drizzle): `fleetOperationShifts`, `fuelTelemetryHourly`, `fuelTelemetryFetches`, `fleetOperationDayMarks`, con estas columnas:
  - `fleet_operation_shifts`: `id` text pk, `vehicle_id` → `fuel_vehicles` (restrict), `shift_date` text, `start_hour` smallint, `end_hour` smallint, `operator_worker_id` → `workers` (restrict), `operator_name_snapshot` text, `notes` text not null default `''`, `import_ref` text, `created_by` / `updated_by` → `users`, `created_at`, `updated_at`, `voided_at`, `voided_by` → `users`, `void_reason` text. Checks: `shift_date ~ '^\d{4}-\d{2}-\d{2}$'`, horas entre 0 y 23, `start_hour <> end_hour`, `voided_at` y `voided_by` juntos. Índices: `(vehicle_id, shift_date)`, `(operator_worker_id, shift_date)`, único parcial `import_ref` donde no es null.
  - `fuel_telemetry_hourly`: `vehicle_id` → `fuel_vehicles` (cascade), `day` text, `hour` smallint 0–23, `source` text, `idle_seconds` / `working_seconds` / `running_seconds` integer ≥ 0, `updated_at`. PK compuesta `(vehicle_id, day, hour, source)`.
  - `fuel_telemetry_fetches`: `vehicle_id` → `fuel_vehicles` (cascade), `day` text, `segments_fetched_at` timestamptz null, `daily_fetched_at` timestamptz null. PK `(vehicle_id, day)`.
  - `fleet_operation_day_marks`: `id`, `vehicle_id` → `fuel_vehicles` (restrict), `day` text, `reason` text check in (`sin_operacion_programada`, `otro`), `notes` text not null default `''`, `created_by`, `created_at`. Único `(vehicle_id, day)`.
- SQL agregado al final de la migración: `INSERT INTO "system_settings" ("key","value") VALUES ('submodule.enabled:flota:/flota/turnos','false') ON CONFLICT ("key") DO NOTHING;` (como `0391_round_big_bertha.sql`).

- [ ] **Step 1:** Crear el worktree y la rama `feat/turnos-ralenti` desde `main`; commitear el spec y este plan (`git add docs/superpowers/specs/2026-11-20-turnos-ralenti-design.md docs/superpowers/plans/2026-11-20-turnos-ralenti.md`).
- [ ] **Step 2: Prueba que falla** — `schema-pglite.test.ts` (patrón de `lib/services/fleet-gps-indicators-pglite.test.ts`, con `migratePGlite`):
  - `it("rechaza un turno con inicio igual a fin")` → insert con `startHour: 6, endHour: 6` lanza.
  - `it("rechaza horas fuera de 0–23")` → `startHour: 24` lanza.
  - `it("no admite dos marcas para el mismo equipo y día")`.
  - `it("la pantalla de turnos arranca apagada")` → `system_settings` tiene `submodule.enabled:flota:/flota/turnos` = `'false'`.
- [ ] **Step 3:** `npm run test:pglite -- lib/fleet/shifts/schema-pglite.test.ts` → FAIL (tablas inexistentes).
- [ ] **Step 4:** Escribir `db/schema/fleet-shifts.ts`, exportarlo, `npm run db:generate`, agregar el `INSERT` del interruptor, actualizar checksums, confirmar «No schema changes».
- [ ] **Step 5:** `npm run test:pglite -- lib/fleet/shifts/schema-pglite.test.ts` → PASS; `npm run db:verify-migrations` → OK.
- [ ] **Step 6:** Commit `feat(turnos): esquema de turnos, telemetría por hora y marcas de día`.

### Task 2: Horas locales (puro)

**Files:**
- Create: `lib/fleet/shifts/constants.ts`, `lib/fleet/shifts/types.ts`, `lib/fleet/shifts/hours.ts`
- Test: `lib/fleet/shifts/hours.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type PlainDate = string`
  - `interface ShiftWindow { shiftDate: PlainDate; startHour: number; endHour: number }`
  - `interface HourKey { day: PlainDate; hour: number }` (hora de reloj en Chile)
  - `type SegmentType = "idle" | "working" | "running"`
  - `interface HourSeconds { idle: number; working: number; running: number }`
- Produces (`hours.ts`):
  - `hourKeyId(key: HourKey): string` → `"2026-11-18|06"`.
  - `shiftHourKeys(shift: ShiftWindow): HourKey[]` — de `startHour` hasta `endHour` (exclusivo); si `endHour <= startHour`, sigue en el día siguiente.
  - `parseVisionLinkUtc(value: string): number` — ms epoch; si el texto no trae `Z` ni offset, se lee como UTC.
  - `splitSegmentByChileHour(segment: { startUtc: string; endUtc: string; type: SegmentType }): Array<HourKey & { type: SegmentType; seconds: number }>` — corta en cada cambio de hora del reloj de Chile (`America/Santiago`, helpers de `lib/utils.ts`).
  - `hourEndInstant(key: HourKey): number` — ms del fin de esa hora de reloj.

- [ ] **Step 1: Pruebas que fallan** en `hours.test.ts`:
  - `shiftHourKeys({ shiftDate: "2026-11-09", startHour: 22, endHour: 6 })` → 8 claves: `2026-11-09|22`, `|23`, `2026-11-10|00` … `|05`.
  - `shiftHourKeys({ shiftDate: "2026-11-09", startHour: 6, endHour: 14 })` → 8 claves del mismo día.
  - `parseVisionLinkUtc("2026-11-20T14:32:51")` === `Date.UTC(2026, 10, 20, 14, 32, 51)` y lo mismo con sufijo `Z`.
  - `splitSegmentByChileHour({ startUtc: "2026-11-18T08:50:00", endUtc: "2026-11-18T09:20:00", type: "idle" })` → `[{ day: "2026-11-18", hour: 5, seconds: 600 }, { day: "2026-11-18", hour: 6, seconds: 1200 }]` (UTC−3 en noviembre).
  - Un tramo que cruza la medianoche de Chile se reparte entre los dos días.
  - Día de cambio de horario (2026-04-05 y 2026-09-06): la suma de `seconds` es igual a la duración del tramo, y la hora repetida suma en una sola clave.
- [ ] **Step 2:** `npm run test:fast -- lib/fleet/shifts/hours.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `constants.ts` (valores de Global Constraints), `types.ts` y `hours.ts`.
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Commit `feat(turnos): horas locales de turnos y tramos`.

### Task 3: Cliente VisionLink de tramos

**Files:**
- Modify: `lib/integrations/visionlink/visionlink-client.ts`
- Test: `lib/integrations/visionlink/visionlink-client.test.ts`

**Interfaces:**
- Consumes: el token y `request` privados que ya usa `fetchVisionLinkUtilization`; `MAX_PAGES`.
- Produces:
  - `interface VisionLinkSegment { startStateUtc: string; endStateUtc: string; durationSeconds: number; segmentType: string }`
  - `fetchVisionLinkSegments(credentials: VisionLinkCredentials, query: { serialNumber: string; startDate: string; endDate: string; make?: string }, options?: { fetchImpl?: typeof fetch }): Promise<VisionLinkSegment[]>` — `GET https://services.cat.com/catDigital/assetOperationHistory/v2/assetOperations?makeSerialNumbers=<make>|<serie>&startDate&endDate`; sigue `assetOperations[0].nextSegmentUrl` y después `responseMetadata.nextCursor` como `cursor` sobre esa URL; corta en `MAX_PAGES`; deduplica por `startStateUtc + segmentType`; lanza `VisionLinkClientError` como el resto (429 → `VISIONLINK_RATE_LIMITED`).

- [ ] **Step 1: Pruebas que fallan** (patrón `json()`/`token()` del archivo):
  - `it("arma makeSerialNumbers con CAT por defecto y sigue nextSegmentUrl y el cursor")` → primera URL tiene `makeSerialNumbers=CAT|DKJ30153`, la segunda es la `nextSegmentUrl`, la tercera lleva `cursor=abc`; devuelve los tramos de las tres páginas.
  - `it("deduplica un tramo repetido entre páginas")` → mismo `startStateUtc` y `segmentType` en dos páginas = 1 tramo.
  - `it("un equipo sin tramos devuelve []")` → `assetOperations: []`.
  - `it("un 429 lanza VISIONLINK_RATE_LIMITED")`.
- [ ] **Step 2:** `npm run test:fast -- lib/integrations/visionlink/visionlink-client.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `fetchVisionLinkSegments`.
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Commit `feat(visionlink): cliente de tramos de operación`.

### Task 4: Sync de tramos por hora, constancia y crons

**Files:**
- Create: `lib/integrations/visionlink/visionlink-hourly-sync.ts`
- Modify: `lib/integrations/visionlink/visionlink-sync.ts` (escribir `daily_fetched_at`)
- Modify: `app/api/cron/fuel-visionlink-sync/route.ts` (paso de tramos aislado)
- Create: `app/api/cron/fuel-visionlink-hourly/route.ts` (+ `route.test.ts`)
- Modify: `scripts/cron-runner.mjs`, `docker-compose.yml`
- Create: `scripts/backfill-visionlink-hourly.ts`; Modify: `package.json` (`db:backfill-visionlink-hourly`)
- Test: `lib/integrations/visionlink/visionlink-hourly-sync-pglite.test.ts`

**Interfaces:**
- Consumes: `fetchVisionLinkSegments` (Task 3), `splitSegmentByChileHour`, `parseVisionLinkUtc` (Task 2), `splitRange` y `VISIONLINK_API_SOURCE` (`visionlink-sync.ts`).
- Produces:
  - `interface SyncVisionLinkHourlyResult { from: string; to: string; vehicles: number; segments: number; hoursWritten: number; failedVehicles: Array<{ vehicleCode: string; errorCode: string }> }`
  - `syncVisionLinkHourly(credentials: VisionLinkCredentials, options?: { from?: string; to?: string; lookbackDays?: number; fetchImpl?: typeof fetch; now?: () => Date }): Promise<SyncVisionLinkHourlyResult>` — `to` por defecto `todayInChile()` (incluye hoy), `from` = `to` − (`lookbackDays` − 1). Por cada `fuel_vehicles` con `serial_number`: pide tramos en ventanas de `SEGMENT_WINDOW_DAYS`, reparte por hora, y en una transacción por equipo borra y reinserta sus filas `fuel_telemetry_hourly` del rango (fuente `visionlink-api`) y hace upsert de `segments_fetched_at = now()` para cada día del rango. Un tramo de tipo desconocido se registra con `logger.warn` y no se suma. Si un equipo falla, se anota en `failedVehicles` y se sigue con el resto.
  - `syncVisionLink` además hace upsert de `daily_fetched_at = now()` para cada equipo con serie y cada día de `[from, to]` (aunque VisionLink no haya devuelto fila).
- Crons: el de las 06:00 corre `syncVisionLinkHourly(config, { lookbackDays: DAILY_LOOKBACK_DAYS })` después del diario, en su propio `try`, y agrega `hourly` a la respuesta (un fallo ahí no cambia el contrato del diario). La ruta nueva `fuel-visionlink-hourly` copia autenticación, interruptor y `loadVisionLinkConfig` de la diaria, usa `withCronLock("fuel-visionlink-hourly", …)` y `lookbackDays: HOURLY_LOOKBACK_DAYS`. `cron-runner.mjs`: entrada `fuel-visionlink-hourly` igual a la diaria. `docker-compose.yml`: `15 * * * *`.
- Backfill: `tsx scripts/backfill-visionlink-hourly.ts --from=2026-10-01 [--to=YYYY-MM-DD]` llama `syncVisionLinkHourly` e imprime el resultado sin credenciales.

- [ ] **Step 1: Pruebas que fallan** (`visionlink-hourly-sync-pglite.test.ts`, `fetchImpl` simulado):
  - `it("reparte los tramos por hora local y guarda la constancia de cada día del rango")`.
  - `it("correrlo dos veces deja las mismas filas")` (idempotente).
  - `it("una segunda corrida sin tramos para una hora la deja en cero")` (borra y reinserta, no acumula).
  - `it("si un equipo falla, los demás se guardan y el fallo queda en failedVehicles")`.
  - `it("el sync diario marca daily_fetched_at aunque VisionLink no devuelva fila para un equipo")`.
  - En `route.test.ts` de la ruta nueva: sin credenciales responde deshabilitado; con el candado tomado responde conflicto.
- [ ] **Step 2:** `npm run test:pglite -- lib/integrations/visionlink/visionlink-hourly-sync-pglite.test.ts` y `npm run test:fast -- app/api/cron/fuel-visionlink-hourly` → FAIL.
- [ ] **Step 3:** Implementar sync, cambio en `syncVisionLink`, rutas, runner, compose, script y npm script.
- [ ] **Step 4:** Mismos comandos + `npm run test:fast -- app/api/cron/fuel-visionlink-sync` → PASS.
- [ ] **Step 5:** Commit `feat(visionlink): tramos por hora con cron horario y backfill`.

### Task 5: Cálculo de turnos, equipos y ranking (puro)

**Files:**
- Create: `lib/fleet/shifts/calc.ts`
- Test: `lib/fleet/shifts/calc.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `interface VehicleTelemetry { linked: boolean; hours: Map<string, HourSeconds>; segmentsFetchedAt: Map<PlainDate, string>; dailyFetchedAt: Map<PlainDate, string>; dailyRowDays: Set<PlainDate> }` (`hours` por `hourKeyId`).
  - `isHourKnown(key: HourKey, segmentsFetchedAt: string | undefined): boolean` — `fetchedAt >= hourEndInstant(key) + KNOWN_HOUR_MARGIN_MS`.
  - `type ShiftStatus = "sin_telemetria" | "pendiente" | "sin_senal" | "sin_uso" | "sin_dato_ralenti" | "sobre_meta" | "en_meta"` y `SHIFT_STATUS_LABEL: Record<ShiftStatus, string>` (rótulos de Global Constraints).
  - `interface HoursTotals { idleHours: number; workingHours: number; runningHours: number; engineHours: number; idlePct: number | null }`
  - `summarizeShift(shift: ShiftWindow, tele: VehicleTelemetry, target: number): HoursTotals & { status: ShiftStatus }` — reglas del spec § Reglas de cálculo y § Sin señal (0 min de motor + día con `dailyFetchedAt` y sin `dailyRowDays` = `sin_senal`; 0 min y día sin `dailyFetchedAt` = `pendiente`).
  - `summarizeEquipmentDay(day: PlainDate, shifts: ShiftWindow[], tele: VehicleTelemetry, opts: { outOfService: boolean }): HoursTotals & { assignedEngineHours: number; unassignedEngineHours: number; warnUnassigned: boolean; signal: "ok" | "pendiente" | "sin_senal" | "sin_telemetria" }`
  - `interface OperatorRankingRow { rank: number | null; operatorWorkerId: string; operatorName: string; shifts: number; engineHours: number; workingHours: number; idleHours: number; idlePct: number | null; overTarget: number; pending: number }`
  - `rankOperators(rows: Array<{ operatorWorkerId: string; operatorName: string; summary: ReturnType<typeof summarizeShift> }>): { rows: OperatorRankingRow[]; total: Omit<OperatorRankingRow, "rank" | "operatorWorkerId" | "operatorName"> }`

- [ ] **Step 1: Pruebas que fallan** (`calc.test.ts`, con un `VehicleTelemetry` armado a mano):
  - Turno 06–14 con 1 h de ralentí y 3 h de trabajo → `idlePct` 0,25 y `en_meta` con meta 0,30; con 2 h de ralentí y 2 de trabajo → `sobre_meta`.
  - `running` suma a `engineHours` y no al %.
  - Una hora del turno sin constancia o consultada antes de fin de hora + 1 h → `pendiente`.
  - 0,4 h de motor → `sin_uso`; motor sólo `running` → `sin_dato_ralenti`; `linked: false` → `sin_telemetria`.
  - 0 min de motor con `dailyFetchedAt` y sin fila diaria → `sin_senal`; con fila diaria → `sin_uso`; sin `dailyFetchedAt` → `pendiente`.
  - **Identidad**: equipo-día con turnos 22–06 (del día anterior) y 06–14 → horas del día dentro de turnos + `unassignedEngineHours` = `engineHours` del día; en ralentí y trabajo también.
  - 1,5 h de motor fuera de turnos → `warnUnassigned: true`; con `outOfService: true` → `false`.
  - Ranking: ponderado por horas (no promedio de %), menor % primero, operador sin % al final con `rank: null`, `pending` cuenta turnos pendientes y no mueve el %.
- [ ] **Step 2:** `npm run test:fast -- lib/fleet/shifts/calc.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `calc.ts`.
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Commit `feat(turnos): cálculo de turnos, equipo-día y ranking`.

### Task 6: Permisos, menú y servicio de escritura

**Files:**
- Modify: `modules/flota/manifest.ts`
- Modify: `components/layout/nav-icons.tsx` (agregar `ClockCountdown` al import y al mapa; hoy no está)
- Create: `lib/services/fleet-shifts.ts`
- Test: `lib/services/fleet-shifts-pglite.test.ts`; los tests de navegación/paridad existentes (`npm run test:fast -- navigation`)

**Interfaces:**
- Manifest: permisos `flota:view_shifts` («Ver turnos de operación y ralentí por operador», id `p-flot-view-shifts`) y `flota:manage_shifts` («Registrar, editar y anular turnos de operación», id `p-flot-manage-shifts`), con los grants de Global Constraints; ítem de menú `{ label: "Turnos y ralentí", href: "/flota/turnos", iconName: "ClockCountdown", permissions: ["flota:view_shifts"], group: "Flota" }` en el área `control-operacional`.
- Produces (`fleet-shifts.ts`):
  - `interface ShiftActor { userId: string; email: string | null; scope: string[] | "all" }`
  - `interface ShiftInput { vehicleId: string; shiftDate: string; startHour: number; endHour: number; operatorWorkerId: string; notes: string }`
  - `type ShiftResult = { ok: true; shiftId: string } | { ok: false; message: string }`
  - `createShift(actor: ShiftActor, input: ShiftInput): Promise<ShiftResult>`
  - `updateShift(actor: ShiftActor, shiftId: string, input: ShiftInput): Promise<ShiftResult>`
  - `voidShift(actor: ShiftActor, shiftId: string, reason: string): Promise<{ ok: true } | { ok: false; message: string }>`
  - `setDayMark(actor: ShiftActor, input: { vehicleId: string; day: string; reason: "sin_operacion_programada" | "otro"; notes: string }): Promise<{ ok: true } | { ok: false; message: string }>`
  - `clearDayMark(actor: ShiftActor, input: { vehicleId: string; day: string }): Promise<{ ok: true } | { ok: false; message: string }>`
  - `getIdleTarget(): Promise<number>` (clave `system_settings` `fleet.shifts.idle_target`, fracción; por defecto `IDLE_TARGET_DEFAULT`)
  - `setIdleTarget(actor: ShiftActor, pct: number): Promise<{ ok: true } | { ok: false; message: string }>` (entero 1–99 → fracción)
- Reglas (en una transacción): faena del equipo el `shiftDate` por `stayWorksiteOnDaySql` dentro del alcance; operador activo y con `worksite_id` en el alcance; `shiftDate` entre `2024-01-01` y hoy + 31 días; bloqueo `FOR UPDATE` de la fila del equipo y `pg_advisory_xact_lock(hashtext('shift-operator:' || id))`; cruce por equipo y por operador comparando `shiftHourKeys` de los turnos vigentes de `shiftDate ± 1`, excluyendo el propio al editar; `operator_name_snapshot` = nombre del trabajador; `recordAudit` con `entityType: "fleet_operation_shift"` (y `fleet_operation_day_mark`, `system_setting`) y estados antes/después.
- Mensajes exactos:
  - «La hora de inicio y la de fin no pueden ser iguales.»
  - «Se cruza con el turno de {operador} en {equipo} ({dd-mm} {HH}–{HH}). Corrige el horario o edita ese turno.»
  - «{operador} ya tiene un turno en {equipo} ({dd-mm} {HH}–{HH}).»
  - «No tienes acceso a la faena de ese equipo ese día.»
  - «El turno ya está anulado.»

- [ ] **Step 1: Pruebas que fallan** (`fleet-shifts-pglite.test.ts`, fixtures de `test-fixtures.ts` + trabajadores y `setVehicleWorksiteForTest`):
  - crea un turno y escribe `audit_log`;
  - rechaza inicio = fin; rechaza cruce por equipo (22–06 del 09 contra 02–10 del 10) y por operador en otro equipo, con los mensajes exactos;
  - **editar** un turno sin moverlo no choca consigo mismo; editarlo hacia el horario de otro turno del mismo equipo sí choca;
  - **anular** libera las horas: después se registra otro turno en el mismo horario;
  - un actor con alcance `[wsB]` no crea turnos de un equipo que ese día está en `wsA`;
  - `setDayMark` dos veces el mismo día → el segundo actualiza, no duplica; `clearDayMark` lo quita con auditoría;
  - `getIdleTarget()` sin clave → 0,3; `setIdleTarget(actor, 25)` → 0,25; `setIdleTarget(actor, 0)` → error.
- [ ] **Step 2:** `npm run test:pglite -- lib/services/fleet-shifts-pglite.test.ts` → FAIL.
- [ ] **Step 3:** Manifest y servicio.
- [ ] **Step 4:** Mismo comando + `npm run test:fast -- modules navigation` → PASS.
- [ ] **Step 5:** Commit `feat(turnos): permisos, menú y registro de turnos`.

### Task 7: Lecturas de las tres vistas

**Files:**
- Create: `lib/fleet/shifts/telemetry-loader.ts`, `lib/services/fleet-shifts-views.ts`
- Test: `lib/services/fleet-shifts-views-pglite.test.ts`

**Interfaces:**
- Consumes: Task 5 (`summarizeShift`, `summarizeEquipmentDay`, `rankOperators`), Task 6 (`getIdleTarget`).
- Produces:
  - `loadVehicleTelemetry(vehicleIds: string[], fromDay: PlainDate, toDay: PlainDate): Promise<Map<string, VehicleTelemetry>>` — `linked` = tiene serie; `dailyRowDays` = días con fila `fuel_telemetry_daily` de fuente `visionlink-api`.
  - `interface ShiftRow { id: string; vehicleId: string; vehicleCode: string; shiftDate: string; startHour: number; endHour: number; presetLabel: string | null; operatorWorkerId: string; operatorName: string; notes: string; summary: ReturnType<typeof summarizeShift> }`
  - `interface EquipmentDayRow { vehicleId: string; vehicleCode: string; hasVisionLink: boolean; operationalStatus: "operativo" | "mantencion" | "fuera_servicio"; dayMark: { reason: string; notes: string } | null; shiftsCount: number; summary: ReturnType<typeof summarizeEquipmentDay> }`
  - `getShiftDayView(scope: string[] | "all", day: PlainDate): Promise<{ day: string; target: number; vehicles: EquipmentDayRow[]; shifts: ShiftRow[] }>`
  - `getOperatorRankingView(scope: string[] | "all", q: { from: PlainDate; to: PlainDate; vehicleId?: string }): Promise<{ target: number; ranking: ReturnType<typeof rankOperators> }>` — incluye un turno por su `shift_date` (un 22–06 del día `to` cuenta entero).
  - `getEquipmentGridView(scope: string[] | "all", q: { from: PlainDate; to: PlainDate }): Promise<{ target: number; days: string[]; rows: Array<{ vehicleId: string; vehicleCode: string; cells: Array<{ day: string; kind: "pct" | "detenido" | "fs" | "sp" | "ss" | "vacio"; pct: number | null; engineHours: number }>; engineHours: number; idlePct: number | null }>; stoppedDays: Array<{ day: string; vehicleCode: string; source: "estado" | "marca"; label: string; notes: string; engineHours: number }>; idleLiters: Array<{ vehicleCode: string; byDay: Record<string, number | null>; idleLiters: number; totalLiters: number; idleShare: number | null }> }>` — período máximo 62 días.
  - `listShiftFormOptions(scope: string[] | "all", day: PlainDate): Promise<{ vehicles: Array<{ id: string; code: string; hasVisionLink: boolean }>; operators: Array<{ id: string; name: string; isMachineOperator: boolean }> }>` — equipos activos de las faenas del alcance ese día (con VisionLink primero); trabajadores activos del alcance, «Operador de maquinaria» primero.
- Equipos mostrados en vistas: los del alcance con VisionLink + los que tengan turnos o marcas en el período (spec § Qué equipos aparecen). «FS» = intervalo `mantencion`/`fuera_servicio` que toca el día.

- [ ] **Step 1: Pruebas que fallan**:
  - día con dos turnos y telemetría → `shifts` con estado y %, `vehicles` con aviso de horas sin turno;
  - un equipo sin VisionLink sin turnos no aparece; con un turno, sí, y su turno es `sin_telemetria`;
  - **traslado**: equipo en `wsA` del 1 al 14 y en `wsB` desde el 15 → alcance `[wsB]` sólo ve sus turnos desde el 15;
  - ranking: turno 22–06 del día `to` cuenta entero;
  - grilla: `fs` por intervalo de mantención, `sp` por marca, `ss` por día consultado sin fila diaria;
  - `listShiftFormOptions`: equipos con VisionLink primero; trabajador inactivo excluido.
- [ ] **Step 2:** `npm run test:pglite -- lib/services/fleet-shifts-views-pglite.test.ts` → FAIL.
- [ ] **Step 3:** Implementar loader y vistas.
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Commit `feat(turnos): lecturas de turnos del día, ranking y grilla`.

### Task 8: Pantalla `/flota/turnos` y acciones

**Files:**
- Create: `app/(app)/flota/turnos/page.tsx`, `loading.tsx`, `actions.ts`, `actions.test.ts`
- Create: `app/(app)/flota/turnos/shift-views-tabs.tsx`, `shift-day-view.tsx`, `shift-form.tsx`, `day-mark-control.tsx`, `operator-ranking-view.tsx`, `equipment-grid-view.tsx`, `idle-target-form.tsx`, `idle-bar.tsx`
- Test: `app/(app)/flota/turnos/shift-form.test.tsx`

**Interfaces:**
- Consumes: Tasks 6 y 7.
- Produces (`actions.ts`, `"use server"`, patrón de `app/(app)/flota/traslados/actions.ts`: `guardPermission` + `isRouteOperational("/flota/turnos")` + zod + `revalidatePath("/flota/turnos")`):
  - `createShiftAction(input: ShiftInput)`, `updateShiftAction(shiftId: string, input: ShiftInput)`, `voidShiftAction(shiftId: string, reason: string)`, `setDayMarkAction(...)`, `clearDayMarkAction(...)`, `setIdleTargetAction(pct: number)` — todas con `flota:manage_shifts`; mensaje con el interruptor apagado: «Los turnos aún no están habilitados.»
- Página: `requirePermission("flota:view_shifts")`; si `!isRouteOperational("/flota/turnos")` → `redirect("/flota")`. `?vista=dia|operadores|equipos` (por defecto `dia`), `?dia=` (por defecto ayer), `?desde=&hasta=` (operadores: mes en curso; equipos: últimos 14 días), `?equipo=`. Título «Turnos y ralentí», breadcrumb Control operacional › Turnos y ralentí.
- Formulario en línea plegable (preferencia en `localStorage` con try/catch); `Combobox` de operador; seleccionar un turno predefinido llena Inicio y Fin, y un Inicio/Fin a mano vuelve a «Otro horario».
- Anular con `ConfirmDialog` pidiendo motivo; nada de confirmaciones en guardar.
- En cada equipo del día: marcar «Sin operación programada» / «Otro motivo» (`day-mark-control.tsx`) y, para mantención o avería, un enlace «Cambiar estado en la ficha» a la ficha del vehículo; no se duplica ese flujo.
- Bajo la grilla, una línea que dice la fuente: % y horas desde los tramos de VisionLink; litros desde el resumen diario de VisionLink.
- Todo usable a 390 px de ancho: la grilla y las tablas desplazan dentro de su caja, nunca la página.
- Vacíos con `EmptyState`: «No hay turnos registrados para este día.» + botón «Registrar turno» (si tiene permiso).

- [ ] **Step 1: Pruebas que fallan**:
  - `actions.test.ts`: sin `flota:manage_shifts` → error de permiso; con el interruptor apagado → «Los turnos aún no están habilitados.»; entrada válida delega en `createShift`.
  - `shift-form.test.tsx`: elegir «Noche 22–06» deja Inicio 22 y Fin 06; cambiar Fin a 07 muestra «Otro horario».
- [ ] **Step 2:** `npm run test:fast -- "app/(app)/flota/turnos"` → FAIL.
- [ ] **Step 3:** Implementar acciones, página y componentes.
- [ ] **Step 4:** Mismo comando + `npm run typecheck` + `npm run lint` → PASS.
- [ ] **Step 5:** Commit `feat(turnos): pantalla de turnos y ralentí`.

### Task 9: Importación de los turnos de «Ralentí Cholguán»

**Files:**
- Create: `lib/fleet/shifts/import-plan.ts`, `scripts/import-ralenti-shifts.ts`; Modify: `package.json` (`db:import-ralenti-shifts`)
- Test: `lib/fleet/shifts/import-plan.test.ts`

**Interfaces:**
- Consumes: `shiftHourKeys` (Task 2).
- Produces:
  - `interface RalentiShiftDoc { id: string; equipo: string; fecha: string; ini: number; fin: number; operador: string; obs?: string; actualizado?: string }`
  - `planShiftImport(docs: RalentiShiftDoc[], catalog: { vehicles: Array<{ id: string; code: string }>; workers: Array<{ id: string; firstName: string; lastName: string }>; existingImportRefs: Set<string> }): { rows: Array<ShiftInput & { importRef: string; operatorName: string }>; errors: string[]; operatorOverlaps: string[]; alreadyImported: number }` — nombre comparado sin tildes ni mayúsculas contra `firstName + " " + lastName` (y contra el primer nombre + primer apellido); 0 o más de 1 coincidencia = error; `importRef` = `ralenti:<id>`.
  - Script: `tsx scripts/import-ralenti-shifts.ts --file=<json> --author-email=<correo> [--apply]`; sin `--apply` sólo informa; con errores no escribe nada; con `--apply` inserta en una transacción con `notes` = «Importado de Ralentí Cholguán» (+ la observación original si existe) y `created_by` = el usuario del correo; informa los cruces por operador y las marcas de mantención no importadas.

- [ ] **Step 1: Pruebas que fallan** (`import-plan.test.ts`):
  - «Jose Briceño» calza con «José Ignacio Briceño Soto»; «Jose Godoy» con dos trabajadores → error que nombra a ambos.
  - Equipo inexistente → error.
  - Un doc ya importado se cuenta en `alreadyImported` y no va en `rows`.
  - Vallejos 2026-11-03 GR-06 06–18 y GR-10 14–22 → ambos en `rows` y un aviso en `operatorOverlaps`.
- [ ] **Step 2:** `npm run test:fast -- lib/fleet/shifts/import-plan.test.ts` → FAIL.
- [ ] **Step 3:** Implementar plan y script.
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Commit `feat(turnos): importación desde Ralentí Cholguán`.

### Task 10: Regresión E2E

**Files:**
- Modify: `e2e/setup-db.ts` (bloque «Turnos y ralentí»)
- Create: `e2e/flota-turnos.spec.ts`

**Interfaces:**
- Siembra: usuario `contrato@e2e.chome.cl` (rol `admin_contrato`, faena «Faena E2E»), un equipo `QA-TUR-01` con serie en «Faena E2E» y otro en una segunda faena, el trabajador «QA Operador Turnos» (cargo «Operador de maquinaria»), filas `fuel_telemetry_hourly` y `fuel_telemetry_fetches` para un día fijo pasado (06–14: 1 h de ralentí, 3 h de trabajo), y `submodule.enabled:flota:/flota/turnos` = `'true'`.

- [ ] **Step 1: Pruebas que fallan** (`e2e/flota-turnos.spec.ts`, `login` + `textoVisible` de `e2e/helpers.ts`, `exact: true` en botones):
  - el admin. de contrato abre «Turnos y ralentí» desde el menú, registra Mañana 06–14 para `QA-TUR-01` con «QA Operador Turnos» y ve 25,0 % y «En meta»;
  - en la vista Operadores aparece «QA Operador Turnos» con rango 1;
  - el equipo de la otra faena no aparece en el selector;
  - un usuario sin `flota:view_shifts` va a `/forbidden`.
- [ ] **Step 2:** Correr la spec con base y puerto propios → FAIL.
- [ ] **Step 3:** Siembra y ajustes.
- [ ] **Step 4:** La spec → PASS.
- [ ] **Step 5:** Commit `test(turnos): regresión E2E`.

### Task 11: Verificación completa y prueba en el navegador

**Files:**
- Create: `qa/reports/2026-11-2X-turnos-ralenti.md`

- [ ] **Step 1:** Puertas: `npm run typecheck`, `npm run lint`, `npm run check:secrets`, `npm run test:fast`, `npm run test:pglite`, `npm run db:verify-migrations`, `npm run doctor` → todas en verde (anotar cualquier falla previa de `main` sin tocarla).
- [ ] **Step 2:** `bodega_dev`: `npm run db:migrate`, `npm run db:sync-rbac`, `npm run db:backfill-visionlink-hourly -- --from=2026-10-01` (sólo lectura contra VisionLink), exportar los turnos de la página original con la herramienta de datos del Artifact a un JSON **fuera del repo**, y `db:import-ralenti-shifts` primero sin y luego con `--apply`, con el correo de Patricio.
- [ ] **Step 3:** Encender el interruptor en `bodega_dev` y recorrer `/flota/turnos` en `next dev` :3002 (ver memoria «Navegador en dev local»), como admin. de contrato y como administrador: registrar, editar y anular un turno `QA_`; las tres vistas; un teléfono de 390 px de ancho; consola y red sin errores. Comparar 3 turnos importados con los % que muestra la página original (diferencia esperable por la fuente: anotarla).
- [ ] **Step 4:** Informe con lo verificado, lo no recorrido y las limitaciones del spec; commit `docs(qa): verificación de turnos y ralentí`.

## Puesta en producción (la corre el usuario)

1. Merge a `main` y deploy (el interruptor queda apagado; la migración lo garantiza).
2. `db:sync-rbac` en prod.
3. Backfill de tramos desde 2026-10-01 como one-shot del servicio `migrate` (memoria «Backfills en producción»).
4. Exportar los turnos de la página original e importar con `--dry-run` y luego `--apply`, autor Patricio.
5. Revisar con Patricio el cruce de Vallejos (2026-11-03) y las 2 marcas de mantención del 2026-11-19 (GR-10, CR-52) en la ficha del equipo.
6. Encender «Turnos y ralentí» en Ajustes › Módulos y avisar a Patricio; la página original queda de sólo lectura.
