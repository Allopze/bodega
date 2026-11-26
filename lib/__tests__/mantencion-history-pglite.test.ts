import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { FORMS_CUTOVER_DATE } from "@/lib/mantencion/forms-cutover"
import type { MantViewer } from "@/lib/services/mantencion/access"
import type { MaintenanceHistoryRow, MaintenanceWorkQuery } from "@/lib/services/mantencion/maintenance-work"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * «Historial de mantenciones» contra Postgres de verdad (`loadMaintenanceHistory`, `loadEquipmentTimeline`) y su
 * relación con el Panel (`loadMaintenanceWork`), más los vecinos y el contador de pendientes del importador histórico.
 *
 * Lo que fija cada bloque:
 * - la lista y el Panel cuentan EXACTAMENTE lo mismo para el mismo rango y alcance (mismos ids, mismo total);
 * - el corte de los formularios (01-12-2026) recorta el Panel y la lista, pero no la línea de tiempo del equipo;
 * - pruebas, OT anuladas, OT sin ingreso a taller y el registro que ya cuenta su OT no se cuelan ni se repiten;
 * - alcance por faena, y «la hoja de vida sigue al equipo» sólo con un equipo elegido (no con `?faena=`);
 * - el detalle de cada fuente (ficha, descripción, lectura, responsable, especialidades, equipo sin vincular);
 * - vecinos del historial (anterior/siguiente del mismo equipo) y contador de pendientes.
 *
 * Vecinos del historial: «anterior» = el trabajo hecho antes y «siguiente» = el hecho después (orden cronológico).
 * A igual fecha de trabajo la lista pone la clave de origen menor encima, es decir, más reciente.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __historyDb?: DB }
testGlobal.__historyDb = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__historyDb }, get Tx() { return undefined } }))

const { loadMaintenanceWork, loadMaintenanceHistory, loadEquipmentTimeline, summarizeMaintenanceWork } = await import("@/lib/services/mantencion/maintenance-work")
const { getAdjacentHistoricalRecords, countHistoricalPending } = await import("@/lib/services/mantencion/historical-import")

// ── Identificadores y alcance ───────────────────────────────────────────────

const TODAY = "2026-12-20"
/** Rango del Panel de la prueba: noviembre y diciembre, a los dos lados del corte. */
const PANEL: MaintenanceWorkQuery = { from: "2026-11-01", to: "2026-12-31", today: TODAY }
/** Rango amplio que incluye octubre (la lista sigue aplicando el corte; sólo cambia lo que entra por fecha). */
const WIDE: MaintenanceWorkQuery = { from: "2026-10-01", to: "2026-12-31", today: TODAY }
const CHART = { from: "2026-11-01", to: "2026-12-31", granularity: "month" as const }

const WS = { a: "ws-hist-a", b: "ws-hist-b" } as const
/** a: en la faena A · b: en la faena B · moved: trabajó en A y HOY está en B · n: en A, con su propia historia de septiembre. */
const V = { a: "v-hist-a", b: "v-hist-b", moved: "v-hist-m", n: "v-hist-n" } as const
const U = { jefe: "u-hist-jefe", mech: "u-hist-mech", own: "u-hist-own" } as const
const WK = "wk-hist"
const EQUIPMENT: Record<string, { code: string; plate: string }> = {
  [V.a]: { code: "KA-HA1", plate: "AAAA-01" },
  [V.b]: { code: "KA-HB1", plate: "BBBB-01" },
  [V.moved]: { code: "KA-HM1", plate: "MMMM-01" },
  [V.n]: { code: "KA-HN1", plate: "NNNN-01" },
}

const GLOBAL: MantViewer = { userId: U.jefe, email: null, permissions: ["mant:records:view_all", "mant:ot:view_all"], worksiteIds: [], isGlobal: true }
const SUP_A: MantViewer = { userId: "u-hist-sup-a", email: null, permissions: ["mant:records:view_worksite", "mant:ot:view_worksite"], worksiteIds: [WS.a], isGlobal: false }
const SUP_B: MantViewer = { userId: "u-hist-sup-b", email: null, permissions: ["mant:records:view_worksite", "mant:ot:view_worksite"], worksiteIds: [WS.b], isGlobal: false }
const SUP_AB: MantViewer = { userId: "u-hist-sup-ab", email: null, permissions: ["mant:records:view_worksite", "mant:ot:view_worksite"], worksiteIds: [WS.a, WS.b], isGlobal: false }
/** Sólo lectura de registros de su faena: sin permiso de OT, así que la lista no trae OT. */
const RECORDS_A: MantViewer = { userId: "u-hist-rec-a", email: null, permissions: ["mant:records:view_worksite"], worksiteIds: [WS.a], isGlobal: false }
/** Registros de todas las faenas, sin permiso de OT. */
const RECORDS_ALL: MantViewer = { userId: U.jefe, email: null, permissions: ["mant:records:view_all"], worksiteIds: [], isGlobal: false }
/** Ve todo menos las OT: sólo puede crear las suyas. */
const OWN_OT: MantViewer = { userId: U.own, email: null, permissions: ["mant:records:view_all", "mant:ot:create"], worksiteIds: [], isGlobal: true }
/** Sin ningún permiso de lectura (aunque sea «global» de nombre). */
const NOTHING: MantViewer = { userId: "u-hist-none", email: null, permissions: [], worksiteIds: [], isGlobal: true }

// ── Resultados esperados (ids = `h:<source_key>`, `ot:<id>`, `r:<id>`) ─────────

function sorted(...list: string[]): string[] {
  return [...list].sort()
}

/** Panel (noviembre–diciembre), jefatura: 6 historiales, 5 OT y 2 registros. */
const PANEL_GLOBAL = sorted("h:h-a1", "h:h-b1", "h:h-both", "h:h-fb", "h:h-nov", "h:h-nowo", "ot:o-a1", "ot:o-b1", "ot:o-m1", "ot:o-own", "ot:o-rec", "r:r-c-b-inshop", "r:r-p-a-after")
const PANEL_SUP_A = sorted("h:h-a1", "h:h-fb", "h:h-nov", "ot:o-a1", "ot:o-m1", "ot:o-own", "ot:o-rec", "r:r-p-a-after")
const PANEL_SUP_B = sorted("h:h-b1", "ot:o-b1", "r:r-c-b-inshop")
const PANEL_SUP_AB = sorted("h:h-a1", "h:h-b1", "h:h-fb", "h:h-nov", "ot:o-a1", "ot:o-b1", "ot:o-m1", "ot:o-own", "ot:o-rec", "r:r-c-b-inshop", "r:r-p-a-after")
const PANEL_RECORDS_A = sorted("h:h-a1", "h:h-fb", "h:h-nov", "r:r-p-a-after")
const PANEL_RECORDS_ALL = sorted("h:h-a1", "h:h-b1", "h:h-both", "h:h-fb", "h:h-nov", "h:h-nowo", "r:r-c-b-inshop", "r:r-p-a-after")

/** Lista con octubre incluido (rango WIDE): lo de A y lo de B por separado. */
const WIDE_SUP_A = sorted("h:h-a1", "h:h-fb", "h:h-m1", "h:h-nov", "ot:o-a1", "ot:o-m1", "ot:o-own", "ot:o-rec", "r:r-p-a-after")
const WIDE_SUP_B = sorted("h:h-b1", "h:h-m2", "ot:o-b1", "r:r-c-b-inshop")
const WIDE_RECORDS_A = sorted("h:h-a1", "h:h-fb", "h:h-m1", "h:h-nov", "r:r-p-a-after")

/** Línea de tiempo de cada equipo (sin corte, sin límite de fecha). */
const TIMELINE_A = sorted("h:h-a1", "h:h-a2", "h:h-fb", "h:hn-x", "ot:o-a1", "ot:o-own", "ot:o-rec", "r:r-c-a-before", "r:r-p-a-after")
const TIMELINE_B = sorted("h:h-b1", "h:h-nowo", "ot:o-b1", "r:r-c-b-inshop")
const TIMELINE_MOVED = sorted("h:h-m1", "h:h-m2", "ot:o-m1", "r:r-m-before")
const TIMELINE_N = sorted("h:hn-a", "h:hn-b", "h:hn-c", "h:hn-d")

// ── Datos ───────────────────────────────────────────────────────────────────

const snapshotOf = (vehicleId: string) => ({
  ...EQUIPMENT[vehicleId]!, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Faena", unit: "km" as const,
})

interface HistoricalSeed {
  key: string
  vehicleId?: string
  worksiteId?: string
  entryDate?: string
  submittedAt?: string
  kindText?: string
  actionType?: string
  description: string
  equipmentText?: string
  readingText?: string
  orderText?: string
  laborHours?: number
  exitDate?: string
  specialties?: string[]
  contractText?: string
  qualityNotes?: string
  /** Texto del campo EXTERNO del formulario (lo lee el detalle como responsable). */
  external?: string
  isTest?: boolean
}

/** Historial de formularios. Las filas sin `vehicleId` o sin `worksiteId` son «pendientes» del importador. */
const HISTORIAL: HistoricalSeed[] = [
  { key: "h-a1", vehicleId: V.a, worksiteId: WS.a, entryDate: "2026-11-10", exitDate: "2026-11-12", submittedAt: "2026-11-08 10:00:00", kindText: "ACCION CORRECTIVA", actionType: "correctiva", description: "Cambio de bomba de agua", readingText: "12.345 km", orderText: "OC-77", laborHours: 4.5, specialties: ["mecanica"], contractText: "Residuos", qualityNotes: "Revisar lectura", external: "MAESTRANZA MELO" },
  { key: "h-a2", vehicleId: V.a, worksiteId: WS.a, entryDate: "2026-12-03", actionType: "preventiva", description: "Pauta de 40.000 km (Forms, después del corte)" },
  { key: "h-test", vehicleId: V.a, worksiteId: WS.a, entryDate: "2026-11-15", description: "Respuesta de prueba", isTest: true },
  { key: "h-m1", vehicleId: V.moved, worksiteId: WS.a, entryDate: "2026-10-15", actionType: "preventiva", description: "Cambio de aceite, cuando estaba en A" },
  { key: "h-m2", vehicleId: V.moved, worksiteId: WS.b, entryDate: "2026-10-20", actionType: "correctiva", description: "Reparación, cuando estaba en B" },
  { key: "h-b1", vehicleId: V.b, worksiteId: WS.b, entryDate: "2026-11-20", actionType: "correctiva", description: "Falla de frenos", external: "NO" },
  { key: "h-nov", worksiteId: WS.a, entryDate: "2026-11-18", kindText: "ACCION PREVENTIVA", description: "Revisión de un equipo sin vincular", equipmentText: "KA-99 / ZZZZ-11", external: "SI" },
  { key: "h-nowo", vehicleId: V.b, entryDate: "2026-11-22", actionType: "correctiva", description: "Sin faena conciliada" },
  { key: "h-both", entryDate: "2026-11-19", description: "Sin equipo ni faena", equipmentText: "Equipo ajeno" },
  { key: "h-fb", vehicleId: V.a, worksiteId: WS.a, submittedAt: "2026-11-25 09:30:00", kindText: "CORRECTIVA", description: "Sin fecha de ingreso: cuenta el día del envío" },
  { key: "h-test-sin-equipo", worksiteId: WS.a, entryDate: "2026-11-16", description: "Prueba sin equipo", isTest: true },
  { key: "h-late", worksiteId: WS.a, entryDate: "2026-12-04", description: "Sin equipo, después del corte" },
  { key: "hn-a", vehicleId: V.n, worksiteId: WS.a, entryDate: "2026-09-03", actionType: "correctiva", description: "Vecino A" },
  { key: "hn-b", vehicleId: V.n, worksiteId: WS.a, entryDate: "2026-09-10", actionType: "correctiva", description: "Vecino B" },
  { key: "hn-c", vehicleId: V.n, worksiteId: WS.b, entryDate: "2026-09-10", actionType: "correctiva", description: "Vecino C, en B" },
  { key: "hn-d", vehicleId: V.n, worksiteId: WS.a, submittedAt: "2026-09-20 09:00:00", actionType: "preventiva", description: "Vecino D, sin fecha de ingreso" },
  { key: "hn-t", vehicleId: V.n, worksiteId: WS.a, entryDate: "2026-09-15", description: "Prueba entre vecinos", isTest: true },
  { key: "hn-x", vehicleId: V.a, worksiteId: WS.a, entryDate: "2026-09-12", description: "Otro equipo" },
  { key: "hn-u", worksiteId: WS.a, entryDate: "2026-09-12", description: "Sin equipo de septiembre" },
]
const HISTORIAL_BY_KEY = new Map(HISTORIAL.map((seed) => [seed.key, seed] as const))

type OrderInsert = typeof schema.mantWorkOrders.$inferInsert
/** Una OT con los datos comunes (solicitud de jefatura, fecha 19-11) y lo que cada caso necesita. */
function orderRow(seed: Pick<OrderInsert, "id" | "vehicleId" | "worksiteId" | "status"> & Partial<OrderInsert>): OrderInsert {
  return {
    folio: `OT-${seed.id}`,
    equipmentSnapshot: snapshotOf(seed.vehicleId),
    repair: false,
    maintenance: false,
    requestDate: "2026-11-19",
    requestedByUserId: U.jefe,
    requesterName: "Jefe de Prueba",
    ...seed,
  }
}

type RecordInsert = typeof schema.mantRecords.$inferInsert
/** Un registro firmado por el mecánico en su propia faena (executor «yo»). */
function recordRow(seed: Pick<RecordInsert, "id" | "kind" | "vehicleId" | "worksiteId" | "workDate"> & Partial<RecordInsert>): RecordInsert {
  return {
    folio: `MR-${seed.id}`,
    equipmentSnapshot: snapshotOf(seed.vehicleId),
    reading: 10_000,
    unit: "km",
    registeredBy: U.mech,
    executorKind: "yo",
    executorUserId: U.mech,
    executorName: "Mecánico de Prueba",
    signedAt: `${seed.workDate}T15:00:00Z`,
    receivedAt: `${seed.workDate}T15:00:00Z`,
    status: "vigente",
    ...seed,
  }
}

async function insertHistorical(seed: HistoricalSeed) {
  await testDb.insert(schema.mantHistoricalRecords).values({
    sourceKey: seed.key,
    fingerprint: `fp-${seed.key}`,
    sourceFile: "consolidado.xlsx",
    sourceSheet: "MANTENCIONES",
    sourceRow: 2,
    submittedAt: seed.submittedAt ?? `${seed.entryDate} 10:00:00`,
    worksiteText: seed.worksiteId === WS.a ? "Faena A" : seed.worksiteId === WS.b ? "Faena B" : "Faena sin conciliar",
    worksiteId: seed.worksiteId ?? null,
    equipmentText: seed.equipmentText ?? "Equipo del formulario",
    vehicleId: seed.vehicleId ?? null,
    equipmentMatch: seed.vehicleId ? "linked" : "unmatched",
    orderText: seed.orderText ?? "",
    kindText: seed.kindText ?? "",
    readingText: seed.readingText ?? "",
    description: seed.description,
    entryDate: seed.entryDate ?? null,
    exitDate: seed.exitDate ?? null,
    hoursText: seed.laborHours === undefined ? "" : String(seed.laborHours).replace(".", ","),
    laborHours: seed.laborHours ?? null,
    actionType: seed.actionType ?? null,
    specialties: seed.specialties ?? null,
    contractText: seed.contractText ?? null,
    qualityNotes: seed.qualityNotes ?? null,
    fields: seed.external ? [{ header: "EXTERNO", value: seed.external }] : [],
    importedBy: U.jefe,
    sourceRecordId: `MT-${seed.key}`,
    isTest: seed.isTest ?? false,
  })
}

const ORDERS: OrderInsert[] = [
  // Entró a taller, terminada, interna, con trabajo realizado, reparación y observaciones: gana el trabajo realizado.
  orderRow({
    id: "o-a1", vehicleId: V.a, worksiteId: WS.a, status: "trabajo_terminado", maintenance: true, actionType: "preventiva",
    workPerformed: "Revisión eléctrica completa", repairDescription: "Reparación de luces", observations: "Obs de taller",
    specialties: ["electrica"], laborHours: 6, workshopKind: "interno", workshopName: "Taller Propio",
    workshopEntryAt: "2026-11-20T15:00:00Z", workshopExitAt: "2026-11-24T15:00:00Z", finishedAt: "2026-11-24T16:00:00Z", finishedByUserId: U.mech,
    startedAt: "2026-11-20T16:00:00Z", startedByUserId: U.mech, estimatedDeliveryDate: "2026-11-24",
    assignedToUserId: U.mech, assignedByUserId: U.jefe, assignedAt: "2026-11-19T12:00:00Z", entryOdometer: 12345, entryHourmeter: 1234,
  }),
  // Casilla de mantención sola: tipo preventiva; sin trabajo realizado ni reparación, la descripción son las observaciones.
  orderRow({
    id: "o-m1", vehicleId: V.moved, worksiteId: WS.a, status: "trabajo_terminado", maintenance: true, observations: "Cambio de filtros en taller",
    laborHours: 2, workshopKind: "interno", workshopEntryAt: "2026-11-27T15:00:00Z", workshopExitAt: "2026-11-29T15:00:00Z",
    finishedAt: "2026-11-29T16:00:00Z", finishedByUserId: U.mech, startedAt: "2026-11-27T16:00:00Z", startedByUserId: U.mech,
    estimatedDeliveryDate: "2026-11-29", assignedToUserId: U.mech, assignedByUserId: U.jefe, assignedAt: "2026-11-26T12:00:00Z", requestDate: "2026-11-26",
  }),
  // En taller ahora, externa, sin trabajo realizado: la descripción es la reparación; cuenta hasta hoy.
  orderRow({
    id: "o-b1", vehicleId: V.b, worksiteId: WS.b, status: "en_ejecucion", repair: true, repairDescription: "Reparación de frenos",
    workshopKind: "externo", workshopId: WK, workshopName: "Taller Externo Hist", workshopEntryAt: "2026-12-05T15:00:00Z",
    startedAt: "2026-12-05T16:00:00Z", startedByUserId: U.mech, estimatedDeliveryDate: "2026-12-30",
    assignedToUserId: U.mech, assignedByUserId: U.jefe, assignedAt: "2026-12-04T12:00:00Z", requestDate: "2026-12-04",
  }),
  // La OT que pidió quien sólo ve sus OT: no debe aparecer en su lista.
  orderRow({
    id: "o-own", vehicleId: V.a, worksiteId: WS.a, requestedByUserId: U.own, requesterName: "Quien pidió la OT", status: "en_ejecucion",
    repair: true, repairDescription: "Cambio de neumático", actionType: "correctiva", workshopKind: "interno",
    workshopEntryAt: "2026-11-30T15:00:00Z", startedAt: "2026-11-30T16:00:00Z", startedByUserId: U.mech, estimatedDeliveryDate: "2026-12-30",
    assignedToUserId: U.mech, assignedByUserId: U.jefe, assignedAt: "2026-11-29T12:00:00Z", requestDate: "2026-11-29",
  }),
  // En taller desde el 02-12 (después del corte): la OT cuenta siempre; su registro vinculado no se repite.
  orderRow({
    id: "o-rec", vehicleId: V.a, worksiteId: WS.a, status: "en_ejecucion", repair: true, repairDescription: "Reparación de compresor",
    actionType: "correctiva", workshopKind: "interno", workshopEntryAt: "2026-12-02T15:00:00Z", startedAt: "2026-12-02T16:00:00Z",
    startedByUserId: U.mech, estimatedDeliveryDate: "2026-12-30", assignedToUserId: U.mech, assignedByUserId: U.jefe,
    assignedAt: "2026-12-01T12:00:00Z", requestDate: "2026-12-01",
  }),
  // Anulada, pero con ingreso a taller: tiene que caer por el estado, no por la falta de ingreso.
  orderRow({
    id: "o-void", vehicleId: V.a, worksiteId: WS.a, status: "anulada", repair: true, repairDescription: "Cambio de embrague",
    workshopKind: "interno", workshopEntryAt: "2026-11-21T15:00:00Z", voidedAt: "2026-11-22T12:00:00Z", voidedByUserId: U.jefe,
    voidReason: "Pedida por error", requestDate: "2026-11-20",
  }),
  // Asignada pero sin ingreso a taller: todavía no es un trabajo hecho.
  orderRow({
    id: "o-noingr", vehicleId: V.a, worksiteId: WS.a, status: "asignada", repair: true, repairDescription: "Revisión de frenos",
    assignedToUserId: U.mech, assignedByUserId: U.jefe, assignedAt: "2026-11-24T12:00:00Z", requestDate: "2026-11-23",
  }),
  // Solicitada, por asignar: tampoco.
  orderRow({ id: "o-solic", vehicleId: V.b, worksiteId: WS.b, status: "solicitada", repair: true, repairDescription: "Cambio de correa", requestDate: "2026-12-06" }),
]

const RECORDS: RecordInsert[] = [
  // Correctiva vigente antes del corte y sin OT: sólo la línea de tiempo la muestra.
  recordRow({ id: "r-c-a-before", kind: "C", vehicleId: V.a, worksiteId: WS.a, workDate: "2026-11-25", reading: 9000 }),
  // Preventiva vigente después del corte y sin OT: entra en el Panel y en la lista.
  recordRow({
    id: "r-p-a-after", kind: "P", vehicleId: V.a, worksiteId: WS.a, workDate: "2026-12-02", reading: 12345,
    scheduleVersion: 1, scheduleNameSnapshot: "40.000 km", intervalValue: 40_000, suggestedIntervalValue: 40_000, notes: "Sin novedad",
  }),
  // Externa, en horas, con paso por taller ya cerrado (salida el 07-12).
  recordRow({
    id: "r-c-b-inshop", kind: "C", vehicleId: V.b, worksiteId: WS.b, workDate: "2026-12-04", reading: 500, unit: "h",
    executorKind: "externo", executorUserId: null, executorWorkshopId: WK, executorName: "Taller Externo Hist",
  }),
  // Registro que tiene OT: lo cuenta la OT, no el registro.
  recordRow({ id: "r-linked", kind: "C", vehicleId: V.a, worksiteId: WS.a, workDate: "2026-12-02", workOrderId: "o-rec" }),
  // Anulado: no cuenta en ninguna parte.
  recordRow({ id: "r-anulado", kind: "C", vehicleId: V.a, worksiteId: WS.a, workDate: "2026-12-06", status: "anulado" }),
  // Correctiva de un equipo que se mudó de A a B: antes del corte, sin OT.
  recordRow({ id: "r-m-before", kind: "C", vehicleId: V.moved, worksiteId: WS.a, workDate: "2026-11-28", reading: 8000 }),
]

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values([U.jefe, U.mech, U.own].map((id) => ({
    id, name: id, email: `${id}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
  })))
  const worksite = (id: string, name: string, code: string) => ({ id, name, code, isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([worksite(WS.a, "Faena A", "HIST-A"), worksite(WS.b, "Faena B", "HIST-B")])
  await testDb.insert(schema.mantWorksiteSettings).values([{ worksiteId: WS.a, folioCode: "AHI" }, { worksiteId: WS.b, folioCode: "BHI" }])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-hist", slug: "hist-camion", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  const vehicle = (id: string, worksiteId: string) => ({
    id, code: EQUIPMENT[id]!.code, plate: EQUIPMENT[id]!.plate, type: "Camión", equipmentTypeId: "fet-hist", worksiteId, model: "R450", year: 2021, brand: "Scania",
  })
  // `moved` figura HOY en la faena B aunque sus trabajos antiguos sean de A y de B.
  await testDb.insert(schema.fuelVehicles).values([vehicle(V.a, WS.a), vehicle(V.b, WS.b), vehicle(V.moved, WS.b), vehicle(V.n, WS.a)])
  await testDb.insert(schema.mantWorkshops).values({ id: WK, name: "Taller Externo Hist", nameKey: "taller externo hist" })
  for (const seed of HISTORIAL) await insertHistorical(seed)
  await testDb.insert(schema.mantWorkOrders).values(ORDERS)
  await testDb.insert(schema.mantRecords).values(RECORDS)
  await testDb.insert(schema.mantRecordCorrectives).values([
    { recordId: "r-c-a-before", workTypes: ["Motor"], oils: [], description: "Correctiva de prueba A", hours: 3.5, inWorkshop: false },
    { recordId: "r-c-b-inshop", workTypes: ["Frenos"], oils: [], description: "Cambio de sensor de temperatura", hours: 2, inWorkshop: true, workshopEntryDate: "2026-12-04", workshopReason: "Espera de repuesto" },
    { recordId: "r-linked", workTypes: ["Motor"], oils: [], description: "Trabajo en taller ligado a la OT", hours: 1.5, inWorkshop: false },
    { recordId: "r-anulado", workTypes: ["Motor"], oils: [], description: "Registro anulado de prueba", hours: 1, inWorkshop: false },
    { recordId: "r-m-before", workTypes: ["Motor"], oils: [], description: "Correctiva del equipo movido", hours: 1, inWorkshop: false },
  ])
  await testDb.insert(schema.mantWorkshopUpdates).values({
    id: "wu-r-c-b-inshop", recordId: "r-c-b-inshop", kind: "salio", exitDate: "2026-12-07", userId: U.mech, createdAt: "2026-12-07T15:00:00Z",
  })
})

// ── Ayudas ──────────────────────────────────────────────────────────────────

const historyRows = async (viewer: MantViewer, query: MaintenanceWorkQuery = PANEL): Promise<MaintenanceHistoryRow[]> =>
  (await loadMaintenanceHistory(viewer, query)).rows
const idsOf = (rows: ReadonlyArray<{ id: string }>) => rows.map((row) => row.id).sort()
function rowOf(rows: ReadonlyArray<MaintenanceHistoryRow>, id: string): MaintenanceHistoryRow {
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) throw new Error(`No está la fila ${id}`)
  return row
}
const summary = (rows: Parameters<typeof summarizeMaintenanceWork>[0]) => summarizeMaintenanceWork(rows, { from: PANEL.from, to: PANEL.to, today: TODAY, chart: CHART })

const neighbourInput = (key: string) => {
  const seed = HISTORIAL_BY_KEY.get(key)!
  return { sourceKey: key, vehicleId: seed.vehicleId ?? null, entryDate: seed.entryDate ?? null, submittedAt: seed.submittedAt ?? `${seed.entryDate} 10:00:00` }
}
const neighbours = (viewer: MantViewer, key: string) => getAdjacentHistoricalRecords(viewer, neighbourInput(key))
/** Anterior y siguiente como claves de origen (o `null`). */
const keysOf = (result: { previous: { sourceKey: string } | null; next: { sourceKey: string } | null }) => ({
  previous: result.previous?.sourceKey ?? null,
  next: result.next?.sourceKey ?? null,
})
/** Las claves de los vecinos, sin importar el lado. */
const adjacentKeys = (result: { previous: { sourceKey: string } | null; next: { sourceKey: string } | null }) =>
  [result.previous, result.next].flatMap((neighbour) => (neighbour ? [neighbour.sourceKey] : [])).sort()

// ── Pruebas ─────────────────────────────────────────────────────────────────

describe("la lista del historial y el Panel cuentan lo mismo", () => {
  it.each([
    ["jefatura, todas las faenas", GLOBAL, PANEL_GLOBAL],
    ["supervisor de la faena A", SUP_A, PANEL_SUP_A],
    ["supervisor de la faena B", SUP_B, PANEL_SUP_B],
    ["supervisor de A y B", SUP_AB, PANEL_SUP_AB],
    ["sólo registros de la faena A (sin permiso de OT)", RECORDS_A, PANEL_RECORDS_A],
    ["sólo registros, todas las faenas (sin permiso de OT)", RECORDS_ALL, PANEL_RECORDS_ALL],
    ["sólo sus propias OT (sin permiso de OT)", OWN_OT, PANEL_RECORDS_ALL],
    ["sin ningún permiso de lectura", NOTHING, []],
  ] as Array<[string, MantViewer, string[]]>)("mismos ids y mismo total para el rango del Panel: %s", async (_label, viewer, expected) => {
    const panel = await loadMaintenanceWork(viewer, PANEL)
    const list = await loadMaintenanceHistory(viewer, PANEL)
    expect(idsOf(list.rows)).toEqual(idsOf(panel.rows))
    expect(idsOf(panel.rows)).toEqual(expected)
    expect(list.includesOrders).toBe(panel.includesOrders)
    expect(summary(list.rows).total).toBe(summary(panel.rows).total)
    expect(summary(panel.rows).total).toBe(expected.length)
  })

  it("la igualdad también vale en un rango que cruza octubre y el corte, para jefatura y supervisores", async () => {
    for (const viewer of [GLOBAL, SUP_A, SUP_B]) {
      const panel = await loadMaintenanceWork(viewer, WIDE)
      const list = await loadMaintenanceHistory(viewer, WIDE)
      expect(idsOf(list.rows)).toEqual(idsOf(panel.rows))
      expect(summary(list.rows).total).toBe(summary(panel.rows).total)
    }
    expect(idsOf((await loadMaintenanceHistory(GLOBAL, WIDE)).rows)).toHaveLength(15)
  })

  it("con ?faena= explícita la lista y el Panel también coinciden (y no están vacíos)", async () => {
    for (const worksiteId of [WS.a, WS.b]) {
      const panel = await loadMaintenanceWork(GLOBAL, { ...PANEL, worksiteId })
      const list = await loadMaintenanceHistory(GLOBAL, { ...PANEL, worksiteId })
      expect(list.rows.length).toBeGreaterThan(0)
      expect(idsOf(list.rows)).toEqual(idsOf(panel.rows))
    }
  })

  it("un trabajo del historial sin fecha de ingreso cuenta el día del envío", async () => {
    const rows = await historyRows(GLOBAL, PANEL)
    expect(rowOf(rows, "h:h-fb")).toMatchObject({ date: "2026-11-25", source: "historial" })
  })
})

describe("corte de los formularios (01-12-2026)", () => {
  it("el historial de formularios desde el corte no entra en la lista ni en el Panel, pero sí en la línea de tiempo del equipo", async () => {
    expect(FORMS_CUTOVER_DATE).toBe("2026-12-01")
    const december = await historyRows(GLOBAL, { from: "2026-12-01", to: "2026-12-31", today: TODAY })
    expect(december.filter((row) => row.source === "historial")).toEqual([])
    expect(idsOf(await historyRows(GLOBAL, PANEL))).not.toContain("h:h-a2")
    const timeline = await loadEquipmentTimeline(GLOBAL, V.a, { today: TODAY })
    expect(idsOf(timeline.rows)).toContain("h:h-a2")
  })

  it("un registro sin OT anterior al corte no entra en la lista ni en el Panel, pero sí en la línea de tiempo del equipo", async () => {
    const list = idsOf(await historyRows(GLOBAL, WIDE))
    expect(list).not.toContain("r:r-c-a-before")
    expect(list).not.toContain("r:r-m-before")
    expect(idsOf((await loadEquipmentTimeline(GLOBAL, V.a, { today: TODAY })).rows)).toContain("r:r-c-a-before")
    expect(idsOf((await loadEquipmentTimeline(GLOBAL, V.moved, { today: TODAY })).rows)).toContain("r:r-m-before")
  })

  it("una OT que entró a taller cuenta siempre, también antes del corte", async () => {
    const list = idsOf(await historyRows(GLOBAL, PANEL))
    expect(list).toContain("ot:o-a1")
    expect(list).toContain("ot:o-m1")
  })
})

describe("pruebas, OT anuladas, OT sin taller y registros con OT", () => {
  it("las pruebas, las OT anuladas y las OT sin ingreso a taller no aparecen ni en la lista ni en la línea de tiempo", async () => {
    const forbidden = ["h:h-test", "h:h-test-sin-equipo", "h:hn-t", "ot:o-void", "ot:o-noingr", "ot:o-solic", "r:r-anulado"]
    const seen = [
      ...idsOf(await historyRows(GLOBAL, WIDE)),
      ...idsOf((await loadEquipmentTimeline(GLOBAL, V.a, { today: TODAY })).rows),
      ...idsOf((await loadEquipmentTimeline(GLOBAL, V.b, { today: TODAY })).rows),
      ...idsOf((await loadEquipmentTimeline(GLOBAL, V.moved, { today: TODAY })).rows),
      ...idsOf((await loadEquipmentTimeline(GLOBAL, V.n, { today: TODAY })).rows),
    ]
    for (const id of forbidden) expect(seen).not.toContain(id)
  })

  it("un registro que tiene OT no se repite en la línea de tiempo: lo muestra su OT, una sola vez", async () => {
    const timeline = idsOf((await loadEquipmentTimeline(GLOBAL, V.a, { today: TODAY })).rows)
    expect(timeline).not.toContain("r:r-linked")
    expect(timeline.filter((id) => id === "ot:o-rec")).toHaveLength(1)
    expect(idsOf(await historyRows(GLOBAL, PANEL)).filter((id) => id === "ot:o-rec")).toHaveLength(1)
  })
})

describe("alcance por faena", () => {
  it("con alcance sólo de la faena A, la lista no muestra trabajos de la faena B; con view_all sí los muestra", async () => {
    // Supervisor de A (registros y OT de su faena): ni el historial, ni el registro, ni la OT de B.
    expect(idsOf(await historyRows(SUP_A, WIDE))).toEqual(WIDE_SUP_A)
    // Sólo registros de A, sin permiso de OT: sin OT y sin B.
    expect(idsOf(await historyRows(RECORDS_A, WIDE))).toEqual(WIDE_RECORDS_A)
    // Con view_all ve las dos faenas.
    const all = idsOf(await historyRows(RECORDS_ALL, WIDE))
    expect(all).toEqual(expect.arrayContaining(["h:h-b1", "h:h-m2", "r:r-c-b-inshop"]))
  })

  it("un MantViewer sin permisos de lectura no ve nada: ni lista, ni Panel, ni línea de tiempo, ni vecinos, ni pendientes", async () => {
    expect(await historyRows(NOTHING, WIDE)).toEqual([])
    expect((await loadMaintenanceWork(NOTHING, WIDE)).rows).toEqual([])
    expect((await loadEquipmentTimeline(NOTHING, V.a, { today: TODAY })).rows).toEqual([])
    expect(keysOf(await neighbours(NOTHING, "hn-b"))).toEqual({ previous: null, next: null })
    expect(await countHistoricalPending(NOTHING)).toBe(0)
  })
})

describe("la hoja de vida sigue al equipo (sólo con un equipo elegido)", () => {
  it("el supervisor de B ve en la línea de tiempo lo hecho en A a un equipo que hoy está en B", async () => {
    const timeline = await loadEquipmentTimeline(SUP_B, V.moved, { today: TODAY })
    expect(idsOf(timeline.rows)).toEqual(TIMELINE_MOVED)
    expect(timeline.total).toBe(TIMELINE_MOVED.length)
  })

  it("con ese equipo elegido, el supervisor de B ve también sus trabajos de A en la lista; sin equipo elegido, no", async () => {
    expect(idsOf(await historyRows(SUP_B, { ...WIDE, vehicleId: V.moved }))).toEqual(sorted("h:h-m1", "h:h-m2", "ot:o-m1"))
    expect(idsOf(await historyRows(SUP_B, WIDE))).toEqual(WIDE_SUP_B)
  })

  it("el supervisor de A no ve lo hecho en B a un equipo que hoy está en B: el seguimiento sólo abre lo de su faena", async () => {
    // V.moved figura hoy en B: su supervisor de A ve lo de A (imputado a su faena) y nada de lo de B.
    expect(idsOf((await loadEquipmentTimeline(SUP_A, V.moved, { today: TODAY })).rows)).toEqual(sorted("h:h-m1", "ot:o-m1", "r:r-m-before"))
  })

  it("no ve los trabajos de A de otros equipos: el equipo de A que no se movió no le muestra nada de A", async () => {
    expect(idsOf((await loadEquipmentTimeline(SUP_B, V.a, { today: TODAY })).rows)).toEqual([])
    expect(idsOf((await loadEquipmentTimeline(SUP_B, V.n, { today: TODAY })).rows)).toEqual(["h:hn-c"])
  })

  it("con ?faena=A explícita la lista no se amplía por el equipo", async () => {
    expect(idsOf(await historyRows(SUP_AB, { ...WIDE, vehicleId: V.moved, worksiteId: WS.a }))).toEqual(sorted("h:h-m1", "ot:o-m1"))
    expect(idsOf(await historyRows(SUP_B, { ...WIDE, vehicleId: V.moved, worksiteId: WS.a }))).toEqual([])
    expect(idsOf(await historyRows(SUP_AB, { ...WIDE, vehicleId: V.moved }))).toEqual(sorted("h:h-m1", "h:h-m2", "ot:o-m1"))
  })

  it("con un equipo elegido, la lista sigue al equipo y el Panel con el mismo filtro no (diferencia documentada)", async () => {
    // El Panel no sigue al equipo: con `vehicleId` sólo cuenta lo imputado a la faena del supervisor. Por eso sus
    // cifras por equipo no cuadran con la lista de ese equipo cuando el equipo cambió de faena.
    const panel = await loadMaintenanceWork(SUP_B, { ...WIDE, vehicleId: V.moved })
    expect(idsOf(panel.rows)).toEqual(["h:h-m2"])
  })

  it("la línea de tiempo va del más reciente al más antiguo; `limit` recorta las filas pero no el total", async () => {
    const timeline = await loadEquipmentTimeline(GLOBAL, V.a, { limit: 3, today: TODAY })
    expect(timeline.rows.map((row) => row.id)).toEqual(["h:h-a2", "ot:o-rec", "r:r-p-a-after"])
    expect(timeline.total).toBe(TIMELINE_A.length)
  })

  it("la línea de tiempo de cada equipo trae sus trabajos completos (jefatura)", async () => {
    expect(idsOf((await loadEquipmentTimeline(GLOBAL, V.a, { today: TODAY })).rows)).toEqual(TIMELINE_A)
    expect(idsOf((await loadEquipmentTimeline(GLOBAL, V.b, { today: TODAY })).rows)).toEqual(TIMELINE_B)
    expect(idsOf((await loadEquipmentTimeline(GLOBAL, V.n, { today: TODAY })).rows)).toEqual(TIMELINE_N)
  })
})

describe("OT: sólo con visibilidad de OT", () => {
  it("quien ve sólo sus OT no recibe ninguna fila de OT y la lista dice que no incluye OT", async () => {
    const list = await loadMaintenanceHistory(OWN_OT, WIDE)
    expect(list.includesOrders).toBe(false)
    expect(idsOf(list.rows).filter((id) => id.startsWith("ot:"))).toEqual([])
    expect(idsOf(list.rows)).toContain("r:r-p-a-after")
    const timeline = await loadEquipmentTimeline(OWN_OT, V.a, { today: TODAY })
    expect(timeline.includesOrders).toBe(false)
    expect(idsOf(timeline.rows).filter((id) => id.startsWith("ot:"))).toEqual([])
    expect((await loadMaintenanceHistory(GLOBAL, WIDE)).includesOrders).toBe(true)
  })
})

describe("detalle de cada trabajo", () => {
  it("cada fuente trae su ficha: historial, OT y registro", async () => {
    const rows = await historyRows(GLOBAL, PANEL)
    expect(rowOf(rows, "h:h-a1").detail.href).toBe("/mantencion/registros/historicos/h-a1")
    expect(rowOf(rows, "ot:o-a1").detail.href).toBe("/mantencion/ot/o-a1")
    expect(rowOf(rows, "r:r-p-a-after").detail.href).toBe("/mantencion/registros/r-p-a-after")
  })

  it("la descripción sigue el orden de cada fuente: OT (trabajo realizado, reparación, observaciones), correctiva y preventiva", async () => {
    const rows = await historyRows(GLOBAL, PANEL)
    expect(rowOf(rows, "ot:o-a1").detail.description).toBe("Revisión eléctrica completa")
    expect(rowOf(rows, "ot:o-b1").detail.description).toBe("Reparación de frenos")
    expect(rowOf(rows, "ot:o-m1").detail.description).toBe("Cambio de filtros en taller")
    expect(rowOf(rows, "r:r-c-b-inshop").detail.description).toBe("Cambio de sensor de temperatura")
    expect(rowOf(rows, "r:r-p-a-after").detail.description).toBe("40.000 km — Sin novedad")
  })

  it("la lectura del historial es el texto del formulario, y la de la plataforma sale formateada", async () => {
    const rows = await historyRows(GLOBAL, PANEL)
    expect(rowOf(rows, "h:h-a1").detail.reading).toBe("12.345 km")
    expect(rowOf(rows, "ot:o-a1").detail.reading).toBe("12.345 km · 1.234 h")
    expect(rowOf(rows, "ot:o-b1").detail.reading).toBeNull()
    expect(rowOf(rows, "r:r-p-a-after").detail.reading).toBe("12.345 km")
    expect(rowOf(rows, "r:r-c-b-inshop").detail.reading).toBe("500 h")
  })

  it("el responsible sólo aparece si el trabajo es externo y trae nombre", async () => {
    const rows = await historyRows(GLOBAL, PANEL)
    expect(rowOf(rows, "h:h-a1").detail.responsible).toBe("MAESTRANZA MELO")
    expect(rowOf(rows, "h:h-nov").detail.responsible).toBeNull()
    expect(rowOf(rows, "h:h-b1").detail.responsible).toBeNull()
    expect(rowOf(rows, "ot:o-a1").detail.responsible).toBeNull()
    expect(rowOf(rows, "ot:o-b1").detail.responsible).toBe("Taller Externo Hist")
    expect(rowOf(rows, "r:r-p-a-after").detail.responsible).toBeNull()
    expect(rowOf(rows, "r:r-c-b-inshop").detail.responsible).toBe("Taller Externo Hist")
  })

  it("las especialidades salen de la fuente y el equipo o la faena sin vincular se marcan", async () => {
    const rows = await historyRows(GLOBAL, PANEL)
    expect(rowOf(rows, "h:h-a1").detail.specialties).toEqual(["mecanica"])
    expect(rowOf(rows, "ot:o-a1").detail.specialties).toEqual(["electrica"])
    expect(rowOf(rows, "r:r-p-a-after").detail.specialties).toEqual([])
    expect(rowOf(rows, "h:h-nov")).toMatchObject({ vehicleId: null, equipmentLabel: "KA-99 / ZZZZ-11" })
    expect(rowOf(rows, "h:h-nov").detail).toMatchObject({ unlinkedEquipment: true, unlinkedWorksite: false })
    expect(rowOf(rows, "h:h-nowo").detail).toMatchObject({ unlinkedEquipment: false, unlinkedWorksite: true })
    expect(rowOf(rows, "h:h-a1").detail).toMatchObject({ unlinkedEquipment: false, unlinkedWorksite: false, orderText: "OC-77", contract: "Residuos" })
  })

  it("el tipo sale del campo de la fuente, o de las casillas de la OT, y los días en taller salen de las fechas", async () => {
    const rows = await historyRows(GLOBAL, PANEL)
    expect(rowOf(rows, "h:h-nov").actionType).toBe("preventiva")
    expect(rowOf(rows, "ot:o-m1").actionType).toBe("preventiva")
    expect(rowOf(rows, "ot:o-b1").actionType).toBe("correctiva")
    expect(rowOf(rows, "h:h-a1")).toMatchObject({ workshopDays: 2, inWorkshop: false, laborHours: 4.5 })
    expect(rowOf(rows, "ot:o-a1")).toMatchObject({ workshopDays: 4, inWorkshop: false, laborHours: 6 })
    expect(rowOf(rows, "ot:o-b1")).toMatchObject({ workshopDays: 15, inWorkshop: true, external: true })
    expect(rowOf(rows, "r:r-c-b-inshop")).toMatchObject({ workshopDays: 3, inWorkshop: false, laborHours: 2, external: true })
  })

  it("sin detail (el Panel) las filas no traen la propiedad detail", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, PANEL)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).not.toHaveProperty("detail")
  })
})

describe("vecinos del historial y pendientes del importador", () => {
  it("anterior y siguiente son los dos trabajos vecinos del mismo equipo: sin pruebas ni otros equipos", async () => {
    // Sin fijar el lado: hn-t (prueba, entre hn-b y hn-d) y hn-x/hn-u (otro equipo o sin equipo) no son vecinos.
    expect(adjacentKeys(await neighbours(GLOBAL, "hn-b"))).toEqual(["hn-c", "hn-d"])
    expect(adjacentKeys(await neighbours(GLOBAL, "hn-c"))).toEqual(["hn-a", "hn-b"])
    expect(adjacentKeys(await neighbours(GLOBAL, "hn-d"))).toEqual(["hn-b"])
    expect(adjacentKeys(await neighbours(GLOBAL, "hn-a"))).toEqual(["hn-c"])
  })

  it("sin equipo vinculado no hay vecinos: ambos null, aunque haya otras filas sin equipo", async () => {
    expect(keysOf(await neighbours(GLOBAL, "h-nov"))).toEqual({ previous: null, next: null })
    expect(keysOf(await neighbours(GLOBAL, "hn-u"))).toEqual({ previous: null, next: null })
  })

  it("respeta la visibilidad: el supervisor de B no recibe vecinos de A que el equipo ya no tiene", async () => {
    expect(keysOf(await neighbours(SUP_B, "hn-c"))).toEqual({ previous: null, next: null })
    expect(keysOf(await neighbours(SUP_A, "h-m1"))).toEqual({ previous: null, next: null })
    // Con las dos faenas sí se ve el trabajo de B del mismo equipo que se mudó.
    expect(adjacentKeys(await neighbours(SUP_AB, "h-m1"))).toEqual(["h-m2"])
    // El equipo sigue en A: su supervisor ve la cadena completa, también lo hecho en B.
    expect(adjacentKeys(await neighbours(SUP_A, "hn-b"))).toEqual(["hn-c", "hn-d"])
  })

  it("anterior es el trabajo hecho antes y siguiente el hecho después, con fecha de trabajo distinta", async () => {
    // Equipo movido (GLOBAL): h-m1 (15-10) es anterior a h-m2 (20-10). Del primero no hay anterior y su siguiente es h-m2.
    expect(keysOf(await neighbours(GLOBAL, "h-m1"))).toEqual({ previous: null, next: "h-m2" })
    expect(keysOf(await neighbours(GLOBAL, "h-m2"))).toEqual({ previous: "h-m1", next: null })
  })

  it("a igual fecha de trabajo decide la clave de origen: la menor es la más reciente (como en la lista)", async () => {
    // hn-b y hn-c son del 10-09 y hn-a del 03-09: de hn-c, el anterior es hn-a (más antiguo) y el siguiente hn-b (clave menor, a la misma fecha).
    expect(keysOf(await neighbours(GLOBAL, "hn-c"))).toEqual({ previous: "hn-a", next: "hn-b" })
  })

  it("el contador de pendientes cuenta las filas sin equipo o sin faena (una vez si faltan ambas), con pruebas y posteriores al corte, y respeta la visibilidad", async () => {
    // Jefatura: h-nov, h-nowo, h-both, h-test-sin-equipo (prueba), h-late (posterior al corte) y hn-u.
    expect(await countHistoricalPending(GLOBAL)).toBe(6)
    // Supervisor de A: sólo las de su faena o de un equipo que hoy está en A (h-nowo es de un equipo de B).
    expect(await countHistoricalPending(SUP_A)).toBe(4)
    // Supervisor de B: sólo h-nowo, que es de un equipo que hoy está en B.
    expect(await countHistoricalPending(SUP_B)).toBe(1)
  })
})
