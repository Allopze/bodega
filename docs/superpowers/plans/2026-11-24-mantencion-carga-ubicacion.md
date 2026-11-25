# Carga de Mantención 2026-11-24: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cargar los 220 equipos del dataset, ajustar las pautas, agregar talleres y «sin ubicación» como figuras que no son faenas, soportar equipos sin medidor y aplicar la regla 2.5 de alertas.

**Architecture:** Una migración aditiva (T0) fija el esquema. Un núcleo puro (T1) define estados, unidad por equipo y elegibilidad de alertas. Los servicios leen y escriben con ese núcleo (T2, T3). El cargador (T4, T5) es un plan puro más una capa de escritura sobre los servicios existentes, con simulación por defecto. La app del mecánico (T6) y las E2E (T7) cierran.

**Tech Stack:** Next.js 16 (leer `node_modules/next/dist/docs/` antes de tocar rutas), Drizzle + PostgreSQL, PGlite para pruebas de servicio, Vitest, Playwright, tsx para scripts.

**Spec:** `docs/superpowers/specs/2026-11-24-mantencion-carga-ubicacion-design.md` (aprobado el 2026-11-24). Léelo antes de cada tarea.

## Global Constraints

- La faena de un equipo existente cambia **solo** con `transferVehiclesTx` (`lib/services/fleet-transfers.ts`). Nunca `UPDATE fuel_vehicles.worksite_id` directo.
- Migraciones: solo `npm run db:generate`; nunca editar el journal ni una migración publicada; luego `node scripts/verify-migration-chain.mjs --update-checksums` y `npm run db:generate` debe decir «No schema changes».
- No se crean faenas nuevas (ENAP, Campo Pangui, Rodantes). No se crean mecánicos ni usuarios. No se borra ningún registro: bajas y cierres con estado o fecha.
- Toda escritura del cargador queda en `recordAudit` con actor «sistema: carga mantención 2026-11-24» y la fuente. Sin secretos en código, logs ni informes.
- Fechas con `formatDate`/`formatDateTime`; el día de hoy con `todayInChile()`, nunca `new Date().toISOString().slice(0,10)`.
- Exportaciones en Excel. Formularios con `Field` de `@/components/ui/field`. Reusar antes de crear (`components/ui/`, `lib/hooks/`).
- Archivos ≤300 líneas (máximo 500). Textos de UI simples, en español, para mecánicos.
- No cambiar lo ya decidido: la próxima mantención cae en múltiplos de la frecuencia (`suggestInterval` intacta); las fotos de filtros y sticker siguen obligatorias para cerrar una preventiva.
- Etiquetas exactas: «Sin lectura de partida», «Pauta por definir», «Sin ubicación», «Fuera de servicio», «Declarada por el mecánico, sin respaldo».
- Pruebas: un archivo `npx vitest run <ruta>`; PGlite con `--config vitest.pglite.config.ts`; todo archivo PGlite nuevo se registra en `tests/pglite-files.ts` (lo hace T0 para todos).
- Puertas finales: `npm run typecheck`, `npm run lint`, `npm run test:fast`, `npm run test:pglite`, `npm run db:verify-migrations`.

## Review Focus

1. **Segunda corrida del cargador** tras haber trasladado: no vuelve a trasladar ni a crear. Pinned en T5.
2. **Filas sin patente o con código igual a la patente** (TO-27, GR-08, TO-37, H-7, JC-5993, GRDW-63): una clave vacía nunca empareja; si código = patente no se escribe código. Pinned en T4.
3. **`cambio_desde` con `*`, fecha anterior a la estadía abierta o a la ventana, y destino inactivo que no es `sistema`**. Pinned en T3 y T4.
4. **Cola offline vieja:** registro con lectura para un equipo sin unidad, o correctiva sin lectura para un equipo con unidad; catálogo viejo sin `alertBlock`. Pinned en T2 y T6.
5. **«Sin ubicación» o un taller visible como faena** en Prevención, indicadores de flota o combustibles. Pinned en T3b.

## File Structure

| Área | Archivos |
| --- | --- |
| Esquema (T0) | `db/schema/{mantencion-catalogs,mantencion-records,fuel-vehicles,worksites}.ts`, migración nueva, `db/migrations/meta/_sql-checksums.json`, `lib/worksites/worksite-kind.ts`, `tests/pglite-files.ts` |
| Núcleo puro (T1) | `lib/mantencion/{types,status,format,contracts}.ts`, `lib/mantencion/unit.ts` (nuevo) y los consumidores de `MantEquipmentState` |
| Servicios (T2, T3a) | `fleet.ts`, `catalog.ts`, `equipment-resolve.ts`, `fleet-incorporation.ts`, `records-create*.ts`, `work-orders/query.ts`, `equipment-location.ts` (nuevo), `catalog-admin.ts`, `lib/fleet/transfer-rules.ts`, `lib/services/fleet-transfers.ts` |
| UI y auditoría (T1b, T3b) | componentes de jefatura, Flota, `lib/worksites/visibility.ts` (nuevo) |
| Cargador (T4, T5) | `scripts/carga-mantencion-2026-11-24/*.ts`, `scripts/apply-mantencion-carga-2026-11-24.ts`, `db/seed/mantencion-carga-2026-11-24.csv` |
| App y E2E (T6, T7) | `components/mantencion/app/*`, `lib/mantencion/client/*`, `e2e/mantencion-6-carga.spec.ts`, `e2e/fixtures/mantencion-carga-setup.ts` |

## Waves

Wave 0: T0. Wave 1 (paralelo): T1a, T3a, T4. Wave 2 (paralelo): T1b, T2a, T2b, T3b. Wave 3 (paralelo): T5, T6. Wave 4: T7 y cierre. Cada wave termina con una revisión (`revisor-mantencion`) y `typecheck` verde antes de la siguiente.

---

### Task 0: Worktree y migración

**Files:**
- Modify: `db/schema/mantencion-catalogs.ts` (`mantWorkshops`: `kind`, `worksiteId`; `mantEquipmentProfiles`: `unitOverride`; `MANT_EQUIPMENT_HISTORY_ACTIONS` y su `check`: `location_change`)
- Modify: `db/schema/mantencion-records.ts` (`reading` nulo), `db/schema/fuel-vehicles.ts` (`physicalWorkshopId`), `db/schema/worksites.ts` (check de `kind` con `sistema`), `lib/worksites/worksite-kind.ts` (`WORKSITE_KINDS` + etiqueta «Sistema»)
- Create: migración generada, `db/__tests__/mantencion-carga-schema-pglite.test.ts`
- Modify: `tests/pglite-files.ts` (registrar las 5 pruebas PGlite nuevas: `db/__tests__/mantencion-carga-schema-pglite.test.ts`, `lib/__tests__/mantencion-carga-fleet-pglite.test.ts`, `lib/__tests__/mantencion-sin-medidor-pglite.test.ts`, `lib/__tests__/mantencion-ubicacion-pglite.test.ts`, `scripts/__tests__/apply-mantencion-carga-2026-11-24-pglite.test.ts`)

**Interfaces:**
- Produces: `mantWorkshops.kind` (`'interno'|'externo'`, default `'externo'`), `mantWorkshops.worksiteId` (FK `worksites`, obligatorio sii `kind='interno'`), `mantEquipmentProfiles.unitOverride` (`'km'|'h'|null`), `fuelVehicles.physicalWorkshopId` (FK `mant_workshops`, `restrict`), `mantRecords.reading` nullable, `worksites.kind` admite `'sistema'`, acción de historial `'location_change'`.
- La migración también ejecuta, idempotente: `UPDATE worksites SET kind = 'sistema' WHERE code = 'MANT-SUB'` (al final, tras `--> statement-breakpoint`).

- [ ] **Step 1: Crear el worktree**

```bash
git -C /home/allopze/dev/chome/bodega worktree add /home/allopze/dev/chome/bodega-wt/mantencion-carga -b feat/mantencion-carga-ubicacion main
cp docs/superpowers/specs/2026-11-24-mantencion-carga-ubicacion-design.md docs/superpowers/plans/2026-11-24-mantencion-carga-ubicacion.md <worktree>/docs/superpowers/{specs,plans}/
ln -s /home/allopze/dev/chome/bodega/node_modules <worktree>/node_modules && cd <worktree> && npm run prepare
```
Copiar también `.env*` que usan las pruebas (sin imprimirlos). Commit de los dos documentos en la rama.

- [ ] **Step 2: Escribir la prueba que falla** (`db/__tests__/mantencion-carga-schema-pglite.test.ts`, plantilla: `scripts/__tests__/apply-trinorma-equipos-faltantes-pglite.test.ts`): 
  `rechaza un taller interno sin faena`; `rechaza un taller externo con faena`; `acepta un taller interno con faena`; `guarda un registro con reading nulo`; `acepta worksites.kind = 'sistema' y rechaza 'otro'`; `acepta la acción location_change`; `unitOverride solo admite km, h o nulo`; `la migración deja MANT-SUB como sistema` (insertar la faena antes de migrar no es posible: probar con el `UPDATE` ejecutado a mano sobre una faena `MANT-SUB`).
- [ ] **Step 3:** `npx vitest run db/__tests__/mantencion-carga-schema-pglite.test.ts --config vitest.pglite.config.ts` → FAIL (columnas inexistentes).
- [ ] **Step 4:** Editar el esquema, `npm run db:generate`, anexar el `UPDATE` idempotente y los `CHECK` que Drizzle no genere, `node scripts/verify-migration-chain.mjs --update-checksums`, `npm run db:generate` («No schema changes»), `npm run db:verify-migrations`.
- [ ] **Step 5:** Misma prueba → PASS; `npm run typecheck` verde (los consumidores de `reading` pueden ahora ser `number | null`: arreglar solo lo mínimo para compilar, sin cambiar comportamiento).
- [ ] **Step 6:** Commit `feat(db): esquema de la carga de mantención (talleres, unidad por equipo, ubicación)`.

---

### Task 1a: Núcleo puro (estados, unidad, contratos)

**Files:**
- Modify: `lib/mantencion/types.ts`, `status.ts`, `format.ts`, `contracts.ts`, `panel-coverage.ts` (+ su test)
- Create: `lib/mantencion/unit.ts`
- Test: `lib/mantencion/__tests__/status.test.ts`, `lib/mantencion/__tests__/format.test.ts`, `lib/mantencion/__tests__/unit.test.ts` (nuevo), `lib/services/mantencion/panel-coverage.test.ts`

**Interfaces (producidas; T2, T3b y T6 las usan tal cual):**
```ts
// types.ts
export type MantAlertBlock = "fuera_servicio" | "sin_ubicacion"
export const MANT_EQUIPMENT_STATES = ["vencida","proxima","sin_preventiva","al_dia","sin_lecturas","pauta_por_definir","sin_pauta","sin_ubicacion","fuera_servicio","baja"] as const
// MantPreventiveSummary.origin: "firmada" | "declarada" | "declarada_mecanico"
// unit.ts
export function resolveUnit(meterType: string, override: MantUnit | null | undefined): MantUnit | null // override ?? odometer→km, hour_meter→h, none→null
// status.ts: StatusInput gana `alertBlock?: MantAlertBlock | null`; `intervals` null = sin pauta, [] = pauta por definir
// contracts.ts: CatalogEquipment.unit: MantUnit | null; CatalogEquipment.alertBlock: MantAlertBlock | null; SyncRecord.reading: number | null; SyncRecord.firstVisit?: { priorPreventive: { date: string; reading: number; intervalValue: number } } | null
```
Orden de precedencia de `equipmentStatus`: `baja` > `fuera_servicio` (alertBlock) > `sin_ubicacion` (alertBlock) > `sin_pauta` (intervals null) > `pauta_por_definir` (intervals `[]`) > `sin_lecturas` > resto actual. `stateRank` sigue el orden de `MANT_EQUIPMENT_STATES`. `fleetCoverage` agrega `outOfScope = pauta_por_definir + sin_ubicacion + fuera_servicio`, que **no** entra en `unknown`.

- [ ] **Step 1: Pruebas que fallan**, con estos nombres y valores: `fuera_servicio gana sobre una pauta vencida`; `sin_ubicacion no calcula próxima` (`nextReading` y `remaining` nulos); `baja gana sobre alertBlock`; `intervals [] → pauta_por_definir`; `intervals null → sin_pauta`; `sin lecturas → etiqueta «Sin lectura de partida»`; `declarada_mecanico con lectura 5.400, intervalo 300, intervalos [300,600,900,1200] y lectura actual 5.500 → nextReading 5.700, estado al_dia`; `suggestInterval(…, 2100) sigue dando 300` (D8); `resolveUnit('none', null) → null`, `('none','h') → 'h'`, `('odometer','h') → 'h'`, `('hour_meter', null) → 'h'`; `fleetCoverage cuenta outOfScope y no lo suma a unknown`.
- [ ] **Step 2:** `npx vitest run lib/mantencion/__tests__ lib/services/mantencion/panel-coverage.test.ts` → FAIL.
- [ ] **Step 3:** Implementar; actualizar `EQUIPMENT_STATE_LABEL` («Sin lectura de partida», «Pauta por definir», «Sin ubicación», «Fuera de servicio») y la etiqueta de origen «Declarada por el mecánico, sin respaldo». No editar archivos de otras tareas: los errores de tipos en consumidores (`Record<MantEquipmentState, …>`) los resuelve T1b.
- [ ] **Step 4:** Mismas pruebas → PASS. **Step 5:** Commit `feat(mantencion): estados, unidad por equipo y contratos del núcleo`.

---

### Task 1b: Consumidores de estados (UI y exportaciones)

**Files (solo estos; cada uno recibe los estados nuevos y las etiquetas nuevas):** `components/mantencion/jefatura/shared/equipment-state-badge.tsx`, `components/mantencion/jefatura/equipos/{equipment-filters,equipment-table,equipment-detail-types}.tsx|ts`, `components/mantencion/app/equipment-history-sheet.tsx`, `app/(app)/mantencion/equipos/page.tsx`, `app/(app)/mantencion/panel/indicators-sections.tsx` (+ test), `app/(print)/mantencion/informe/informe-document.tsx` (+ test), `app/(app)/control-operacional/operational-assets-table.tsx`, `lib/mantencion/client/ot-model.ts`, `lib/operational-control/export-columns.ts`, `lib/services/operational-control.ts`, `lib/services/mantencion/{export-equipment,indicators}.ts` (+ tests), `lib/services/mantencion/looker/types.ts`. **No** tocar `equipment-list.ts` ni su test: son de T2a.

**Interfaces:** Consumes T1a. Produces: ninguna nueva.

- [ ] **Step 1:** `npm run typecheck` → lista de errores por los estados nuevos (es la lista de trabajo).
- [ ] **Step 2: Pruebas:** `el badge de pauta_por_definir, sin_ubicacion y fuera_servicio tiene etiqueta y tono neutro`; `el filtro de estado ofrece los estados nuevos`; `el Excel de equipos exporta «Sin lectura de partida» y no «Sin lecturas»`; `indicators cuenta outOfScope aparte y no lo mezcla con unknown`.
- [ ] **Step 3:** Corregir cada consumidor (tono `neutral` para los estados informativos; ninguno cuenta como vencida). **Step 4:** `npm run typecheck` y las pruebas de los archivos tocados → verde. **Step 5:** Commit.

---

### Task 2a: Lectura de flota con unidad por equipo, sin medidor y bloqueo de alertas

**Files:** `lib/services/mantencion/{fleet,catalog,equipment-resolve,fleet-incorporation,seed-equipment,sync-catalog-version}.ts`, `lib/services/mantencion/looker/{corrective,preventive,resolve,export-planning,export-work}.ts` (solo donde asumen `unit` no nula), `lib/services/mantencion/{equipment-list,equipment-life,app-history,records-query,records-detail}.ts` (idem; `equipment-list.ts` y `lib/__tests__/mantencion-equipment-list.test.ts` también adoptan los estados nuevos). Test: `lib/__tests__/mantencion-carga-fleet-pglite.test.ts`.

**Interfaces:** Consumes T0, T1a. Produces: `FleetRow.unit: MantUnit | null`, `FleetRow.alertBlock: MantAlertBlock | null`, `FleetRow.physicalWorkshop: { id: string; name: string } | null`; `loadFleet` ya **no descarta** equipos sin unidad; el catálogo del sync lleva `unit` nulo y `alertBlock`; subir la versión del catálogo.

- [ ] **Step 1: Pruebas PGlite que fallan:** `una batea sin override aparece en loadFleet con unit null y estado pauta_por_definir cuando su pauta no tiene intervalos`; `un camión con unitOverride h tiene unit h y usa intervalos de horas`; `un equipo con operational_status fuera_servicio queda en estado fuera_servicio`; `un equipo cuya faena es kind sistema queda en sin_ubicacion`; `un camión con pauta, lectura y última preventiva vencida sigue en vencida` (control); `el catálogo trae alertBlock y unit nulo`.
- [ ] **Step 2:** correr → FAIL. **Step 3:** Implementar: reemplazar `unitFromMeter(row.meterType)` por `resolveUnit(row.meterType, row.unitOverride)` en la consulta de `loadFleet`; `alertBlock` = `fuera_servicio` si `fuel_vehicles.operational_status = 'fuera_servicio'`, `sin_ubicacion` si `worksites.kind = 'sistema'`; pasar `intervals` (posiblemente `[]`) cuando hay pauta viva y `null` cuando no hay; `origin: "declarada_mecanico"` cuando `prior_preventive_source` empieza con `app:`. Revisar los demás archivos que llaman `unitFromMeter` y dejarlos tolerar `null`.
- [ ] **Step 4:** PASS + `npx vitest run lib/__tests__/mantencion-equipment-pglite.test.ts --config vitest.pglite.config.ts` (regresión). **Step 5:** Commit.

---

### Task 2b: Registro sin lectura (servidor) y OT de equipos sin medidor

**Files:** `lib/services/mantencion/{records-create,records-create-context,records-create-validate,records-create-validate-corrective,records-create-types}.ts`, `lib/services/mantencion/work-orders/query.ts`, `lib/services/mantencion/web-record.ts`. Test: `lib/__tests__/mantencion-sin-medidor-pglite.test.ts`.

**Interfaces:** Consumes T0, T1a. Produces: `lockAndLoadVehicle` devuelve `unit: MantUnit | null`; `createRecord(input: SyncRecord, context)` acepta `reading: null` solo si el equipo no tiene unidad; `listWorkOrderEquipmentOptions` incluye equipos con `unit: null`.

- [ ] **Step 1: Pruebas que fallan:** `una correctiva de una batea sin lectura se guarda con reading nulo`; `una correctiva de una batea con lectura se rechaza: «Este equipo no lleva lectura.»`; `una correctiva de un camión sin lectura se rechaza`; `una preventiva de una batea se rechaza: «Este equipo solo admite correctivas.»`; `la OT puede crearse para una batea`; `un camión con unitOverride h valida la lectura contra horas` (salto > 300 h pide confirmación).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar en el orden de `validateRecord`: unidad nula ⇒ saltar `checkReading`, historia y regla de salto, exigir `kind === "C"`. **Step 4:** PASS y `lib/__tests__/mantencion-records-pglite.test.ts` sin regresiones. **Step 5:** Commit.

---

### Task 3a: Servicios de ubicación y traslado

**Files:** `lib/services/mantencion/equipment-location.ts` (nuevo), `lib/services/mantencion/{catalog-admin,catalogs,equipment-history}.ts`, `lib/fleet/transfer-rules.ts`, `lib/services/fleet-transfers.ts`, `lib/services/worksite-kind.ts`. Tests: `lib/fleet/__tests__/transfer-rules.test.ts` (o el existente), `lib/__tests__/mantencion-ubicacion-pglite.test.ts`.

**Interfaces (producidas):**
```ts
export async function setVehicleWorkshopTx(tx: Tx, actor: { userId: string; email: string | null },
  input: { vehicleId: string; workshopId: string | null; reason: string }): Promise<{ changed: boolean }>
// transfer-rules.ts: transferDateError(date, today, currentStayStartedOn, minDate?: string)
// fleet-transfers.ts: TransferInput.minDate?: string   // solo lo pasa el cargador
// createCatalogEntry({ catalog: "workshops", name, kind?: "interno" | "externo", worksiteId?: string, actor })
```
- [ ] **Step 1: Pruebas que fallan:** `transferDateError('2026-08-31', '2026-11-24', null)` da error; con `minDate '2026-08-01'` da `null`; `una fecha anterior al inicio de la estadía abierta sigue rechazada aunque minDate la permita`; `un traslado hacia una faena inactiva kind sistema se acepta`; `hacia una inactiva kind operacion se rechaza: «Esa faena no existe o está inactiva.»`; `setVehicleWorkshopTx guarda físico, escribe historial location_change y es idempotente (changed false la segunda vez)`; `un taller interno exige faena`; `la faena del equipo no cambia al poner el taller`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar; el traslado conserva folio, motivo, autorizado por y auditoría. **Step 4:** PASS + `lib/services/fleet-transfers.test.ts` sin regresiones. **Step 5:** Commit.

---

### Task 3b: Mostrar la ubicación y ocultar «Sin ubicación»

**Files:** `lib/worksites/visibility.ts` (nuevo), `lib/services/fleet.ts`, `lib/fleet-overview-filters.ts`, `app/(app)/flota/{fleet-table.tsx,actions.ts}`, `app/(app)/flota/[id]/_ficha/ficha-chrome.tsx`, `app/(app)/mantencion/catalogos/*` (selector de tipo y faena del taller), y las consultas que agrupan equipos por faena sin filtrar `is_active` (inventario con `rg -l "groupBy\(.*worksite|innerJoin\(worksites" lib/services app --glob '!*test*'`; priorizar indicadores de flota, combustibles, GPS, Control operacional y Prevención). Test: `lib/__tests__/worksite-sistema-oculta-pglite.test.ts` (agregar a `tests/pglite-files.ts`).

**Interfaces:** Consumes T0, T2a, T3a. Produces: `export const notSistemaWorksite: SQL` y `export function isVisibleWorksiteKind(kind: string): boolean` (excluyen `sistema`); la ficha y la lista de Flota muestran «En Taller X» o «Sin ubicación»; el Excel de Flota gana la columna «Ubicación».

- [ ] **Step 1: Pruebas que fallan:** con un equipo en MANT-SUB (kind sistema, inactiva) y otro en una faena activa, `la lista de faenas de cada indicador (flota, combustibles, GPS, Prevención) no contiene «Sin ubicación»`; `la lista de Flota muestra «Sin ubicación» como estado del equipo`; `un equipo con taller muestra «En Taller Cholguán» y su faena sigue siendo Cholguan - Arauco`; `Taller Cholguán no aparece en ningún selector de faenas`.
- [ ] **Step 2:** FAIL. **Step 3:** Auditar y excluir `sistema` con `notSistemaWorksite`; mostrar la ubicación. Anotar en el commit cada consulta tocada. **Step 4:** PASS + `npm run typecheck`. **Step 5:** Commit.

---

### Task 4: Dataset y plan puro del cargador

**Files:** `db/seed/mantencion-carga-2026-11-24.csv` (copia exacta de `/tmp/claude-1000/-home-allopze-dev-chome-bodega/f18e9573-c347-4224-980c-30af6de8f576/scratchpad/dataset-equipos-2026-11-24.csv`; si ya no existe, el dataset vive en el encargo del 2026-11-24 y en el spec), `scripts/carga-mantencion-2026-11-24/{dataset,mappings,plan}.ts`. Test: `scripts/carga-mantencion-2026-11-24/__tests__/plan.test.ts`.

**Interfaces (producidas):**
```ts
export interface DatasetRow { codigo: string; patente: string; tipo: string; marca: string; modelo: string; anio: number | null; faena: string; estado: "activo"|"sin_ubicacion"|"baja"|"fuera_servicio"; unidad: "km"|"horas"|"sin_medidor"; pauta: "MANTENER"|"P300-LIVIANA"|"CAMIONETAS-PEND"|"CARROS-PEND"; faenaPlataforma: string; cambioDesde: string | null; cambioEstimado: boolean; vencRt: string; notas: string }
export function parseDataset(csvText: string): DatasetRow[]   // RFC 4180: comillas, comas y "" dentro de campos
export interface ProdVehicle { id: string; code: string | null; plate: string; typeSlug: string; brand: string | null; model: string | null; year: number | null; worksiteName: string; isActive: boolean; operationalStatus: string; locationPending: boolean; physicalWorkshop: string | null; scheduleName: string | null; unitOverride: "km"|"h"|null; hasProfile: boolean }
export function buildPlan(rows: DatasetRow[], prod: ProdVehicle[], today: string): LoadPlan  // puro, sin base
// LoadPlan = { create: PlannedCreate[]; update: PlannedUpdate[]; transfers: PlannedTransfer[]; locations: PlannedLocation[]; skipped: Skipped[]; conflicts: string[] }
```
Reglas del plan (todas del spec §5 y §7.7): identidad con `matchVehicle` de `lib/mantencion/equipment-identity.ts`; mapeo de faenas Cholguán→«Cholguan - Arauco», Teno→«Teno - Arauco», Administración→«Oficina Central», Rodantes→«Santa Fe», ENAP y Campo Pangui→sin traslado; los 6 de Pacífico con otro destino lo respetan y el resto va a «Flor del Laja»; `sin_ubicacion`→faena técnica «Sin ubicación»; `baja` inexistente→`skipped`; `cambio_desde` con `*`→`today` y `cambioEstimado`; traslados agrupados por (origen, destino, fecha) con tope 100; código igual a patente o vacío→no se escribe código; GRDW-63 conserva `batea`; H-16 conserva `fuera_servicio`.

- [ ] **Step 1: Pruebas que fallan:** `parseDataset(CSV real) → 220 filas, estados 186/24/8/2, pautas 17/35/42/126`; `campos con comas y comillas ("VAN 700 CITY 1,2", "inventario: faena ""MANUEL RECART""") se leen enteros`; `TO-27 y GR-08 (sin patente) no emparejan por clave vacía`; `JC-5993 (código = patente) no escribe código`; `KA-135 (cambio_desde '2026-11-24*') planifica fecha 2026-11-24 y estimada`; `CR-47 en Pacífico va a Masisa y CA-19 va a Flor del Laja`; `CA-16 (Campo Pangui) va a Flor del Laja desde Pacífico y no crea faena`; `un grupo de 101 vehículos se parte en dos traslados`; `los 8 baja inexistentes salen en skipped`; `H-13 propone patente LCCT-14`; `GRDW-63 no cambia de tipo`; `CA-61 queda en Taller Eduardo Silva`; `los 7 de Cholguán y 6 de Biodiversa «en taller de la faena» quedan en su taller`.
- [ ] **Step 2:** `npx vitest run scripts/carga-mantencion-2026-11-24` → FAIL. **Step 3:** Implementar `dataset.ts` (parser propio, sin dependencias), `mappings.ts` (faenas, tipos, alias de marca CAT→Caterpillar, M BENZ→Mercedes, SINOTRUCK→Sinotruk, MASEY→Massey Ferguson), `plan.ts`. **Step 4:** PASS. **Step 5:** Commit.

---

### Task 5: Cargador (escritura, simulación e informe)

**Files:** `scripts/carga-mantencion-2026-11-24/{pautas,equipos,ubicacion,traslados,informe}.ts`, `scripts/apply-mantencion-carga-2026-11-24.ts`. Test: `scripts/__tests__/apply-mantencion-carga-2026-11-24-pglite.test.ts` (plantilla: `apply-trinorma-equipos-faltantes-pglite.test.ts`).

**Interfaces:** Consumes T0 a T4. Produces el CLI:
`npx tsx scripts/apply-mantencion-carga-2026-11-24.ts --actor-email <correo> --autorizado-por <texto> [--dataset <csv>] [--report <md>] [--apply]`; sin `--apply` ejecuta todo y deshace la transacción. Una sola transacción con `pg_advisory_xact_lock`. Orden: (1) catálogos: talleres «Taller Cholguán» (interno, faena Cholguan - Arauco) y «Taller Biodiversa» (interno, Biodiversa), marcas y tipos faltantes; (2) pautas: editar «Maquinaria pesada» (ítems `h15`, `h19`, `h34` inactivos; `h25` solo en 900 y 1.200 h; versión nueva con resumen «Carga 2026-11-24») con las funciones del editor, crear «Pauta 300 h: grúas horquilla y equipos por horas» (unidad `h`, intervalo 300, los 27 ítems), «Pauta camionetas (por definir)» y «Pauta bateas y carros (por definir)» sin ítems ni intervalos; (3) altas; (4) actualizaciones; (5) ubicación; (6) traslados con `transferVehiclesTx` y `minDate`, motivo «Carga de mantención 2026-11-24 (inventario 17-11-26)».

- [ ] **Step 1: Pruebas PGlite que fallan** (base con 12 equipos representativos, las 3 pautas, faenas y MANT-SUB): `la simulación no deja ningún cambio en la base y el informe lista los cambios`; `--apply crea 2 altas, actualiza, asigna pautas y traslada con folio TR-0001`; `la segunda corrida con --apply produce 0 cambios, 0 traslados y 0 folios nuevos` (Review Focus 1); `Maquinaria pesada v2: h15, h19, h34 inactivos; h25 aplica solo en 900 y 1.200`; `la pauta de 300 h tiene 27 ítems activos y no incluye «Tren de rodado y herramienta»`; `CAMIONETAS-PEND y CARROS-PEND no tienen intervalos`; `los equipos con CAMIONETAS-PEND quedan en estado pauta_por_definir`; `un equipo sin_ubicacion queda en la faena técnica y con la marca`; `GRDW-63 queda en Taller Biodiversa con faena Biodiversa`; `ninguna fila se borra` (conteos antes y después); `toda escritura tiene entrada en audit_log con el actor «sistema: carga mantención 2026-11-24»`; `un conflicto de identidad aborta sin escribir`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar reusando `updateEquipmentPlanTx`, `incorporateFleetVehicles`/`apply-trinorma-equipos-faltantes`, `setVehicleWorkshopTx`, `transferVehiclesTx`, `setScheduleItemActive`, `setScheduleCell`, `publishSchedule`. Informe Markdown con diff por entidad, saltados, conflictos y pendientes. **Step 4:** PASS. **Step 5:** Commit.

---

### Task 6: App del mecánico (sin lectura, lectura de partida, primera visita)

**Files:** `components/mantencion/app/{step-lectura,flow-screen,step-revisar,equipment-picker}.tsx`, `lib/mantencion/client/{flow,flow-validate,flow-record,flow-types,fleet-view,home-model,types,catalog-sync}.ts`, `lib/services/mantencion/first-visit.ts` (nuevo), `lib/services/mantencion/records-create.ts` (solo la llamada a `applyFirstVisit`). Tests: `lib/mantencion/client/__tests__/flow.test.ts` y `components/mantencion/app/__tests__/*`, `lib/__tests__/mantencion-sin-medidor-pglite.test.ts` (casos de primera visita).

**Interfaces:** Consumes T1a, T2a, T2b. Produces: `applyFirstVisit(tx: Tx, input: { vehicleId: string; userId: string; priorPreventive: { date: string; reading: number; intervalValue: number } }): Promise<void>` (escribe `prior_preventive_*` con `evidence = "Declarada por el mecánico, sin respaldo"` y `source = "app: declarada por el mecánico"`; no pisa una declarada con respaldo).

- [ ] **Step 1: Pruebas que fallan:** `el paso de lectura no aparece para un equipo con unit null`; `el equipo sin lecturas ni registros muestra «Sin lectura de partida» y ofrece «Última preventiva» (fecha, lectura, servicio)`; `la primera visita con última preventiva en 5.400 h y lectura 5.500 h deja próxima 5.700 y estado al_dia`; `la primera visita sin dato deja sin_preventiva`; `no pisa una preventiva declarada por jefatura con respaldo`; `una cola vieja con reading para un equipo sin unidad se rechaza con «Este equipo no lleva lectura.»`; `un catálogo sin alertBlock se interpreta como null` (Review Focus 4).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar; la UI usa solo componentes existentes (`ui.tsx`, `Field`). **Step 4:** PASS + `npx vitest run lib/mantencion/client components/mantencion`. **Step 5:** Commit.

---

### Task 7: E2E, verificación en navegador e informe

**Files:** `e2e/mantencion-6-carga.spec.ts`, `e2e/fixtures/mantencion-carga-setup.ts`, `MANTENCION_CARGA_2026-11-24.md` (raíz).

Las E2E borran `.next` del dev y comparten base y puerto: correr **en el worktree, con base y puerto propios**, nunca contra `bodega_e2e` ni :3100 de otra sesión.

- [ ] **Step 1: E2E secuenciales con estado** (`test.describe.serial`), uno por flujo del spec §8: `1 simulación, apply y segundo apply con cero cambios`; `2 el mecánico de Cholguán ve solo Cholguán y registra lectura y última preventiva en un equipo sin lectura de partida (próxima = última + 300)`; `3 Maquinaria pesada: cadenas en 900 y 1.200 h, no en 300 ni 600; los 3 ítems eliminados no aparecen`; `4 sin_ubicacion, fuera_servicio, CAMIONETAS-PEND y sin lectura de partida no generan alertas; una batea acepta una correctiva sin lectura`; `5 equipos de Santa Fe y Pacífico en su nueva faena con historial y fecha`; `6 Horcones aparece como Arauco y conserva sus registros`; `7 «Sin ubicación» y los talleres no aparecen como faena en Prevención ni en indicadores`.
- [ ] **Step 2:** Verificar en el navegador (Playwright del repo, login por formulario esperando hidratación): lista de equipos con los estados nuevos, ficha con taller, app del mecánico sin lectura para una batea, y consola sin errores nuevos.
- [ ] **Step 3:** Informe `MANTENCION_CARGA_2026-11-24.md` con archivos y líneas, diff de datos por entidad (de la simulación contra una copia de prod, **solo con autorización explícita del usuario**), equipos de prod fuera del dataset (hoy 0), decisiones y pendientes (spec §10), y el resultado de la suite completa sin filtrar.
- [ ] **Step 4:** Suite completa: `npm run typecheck && npm run lint && npm run test:fast && npm run test:pglite && npm run db:verify-migrations && npm run test:e2e` (la última en el entorno aislado). Reportar fallos tal cual; los preexistentes (`module-toggles`, `mantencion-historico`) se anotan, no se tapan.
- [ ] **Step 5:** Commit y preparar el merge a main (turno verificado; `--ff-only` y deploy los corre el usuario).

---

## Ejecución (método indicado por el usuario)

Subagentes en paralelo, modelo `haiku`: `implementador-critico` con `effort: "max"` para T0, T2a, T3b y T5 (esquema, integridad de datos, auditoría de agregaciones, cargador); `implementador-mantencion` con `effort: "xhigh"` para el resto. Cada uno recibe su tarea, el spec, las Global Constraints y **solo** su lista de archivos. Tras cada wave: `revisor-mantencion` (gravedad por hallazgo) y `typecheck`. Revisión final de rama completa con el modelo más capaz antes de pedir el merge.

## Self-review

- Cobertura del spec: §7.1 → T0, T3a, T3b; §7.2 → T1a, T2a, T2b, T6; §7.3 → T0, T1a, T2a; §7.4 → T1a, T1b, T2a; §7.5 → T5; §7.6 → T6; §7.7 → T4, T5; §8 → T7; §10 → informe de T7.
- Tipos consistentes entre tareas: `MantAlertBlock`, `resolveUnit`, `setVehicleWorkshopTx`, `TransferInput.minDate`, `applyFirstVisit`, `ProdVehicle`, `LoadPlan`.
- Riesgo de conflicto de archivos: `contracts.ts` y `types.ts` son solo de T1a; `records-create.ts` es de T2b y T6 solo agrega la llamada (T6 corre después); `tests/pglite-files.ts` es solo de T0.
