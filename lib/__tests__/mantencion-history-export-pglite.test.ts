import { PGlite } from "@electric-sql/pglite"
import ExcelJS from "exceljs"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { HistoryParams } from "@/lib/mantencion/history-view"
import { FORMS_CUTOVER_DATE, FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import type { ExportOutcome } from "@/lib/services/mantencion/export-records"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * «Exportar Excel» del Historial de mantenciones (`exportHistory`) contra Postgres de verdad. Lo que fija:
 *
 * - quien no puede leer el historial (ni de sus faenas ni de todas) no obtiene libro y no deja bitácora;
 * - el libro sólo trae lo que su alcance ve (faena, OT y registros), y `?faena=` no abre otra faena;
 * - el libro trae las mismas filas, en el mismo orden, que la lista con sus filtros: el corte de los formularios
 *   (01-12-2026), las pruebas y las OT anuladas quedan fuera; la OT que entró a taller, dentro;
 * - los filtros (origen, tipo, taller, especialidad, búsqueda y orden) se vuelven a leer en el servidor;
 * - cada celda: textos, horas sin dato vacías (nunca 0), fechas como celdas de fecha reales y ninguna fórmula;
 * - una fila de bitácora por libro: quién, cuántas filas, si se truncó y el nombre del archivo;
 * - la hoja de metadatos nombra el período (sin inventar un 01-01-2000) y avisa si no se ven todas las OT;
 * - el tope de filas corta el libro, lo dice dentro del archivo y lo registra.
 *
 * Dos defectos que esta suite sacó a la luz ya están corregidos y fijados por sus casos: una `?faena=` fuera de alcance
 * se trata como «sin filtro» igual que en la lista (no como un libro vacío), y «Filtros aplicados» no lista filtros sin valor.
 *
 * El reloj sólo se fija en `Date` (no en los timers de PGlite): `exportHistory` llama a `todayInChile()` sin
 * parámetro, así que sin eso el archivo y los días de las OT abiertas dependerían del día en que corre la prueba.
 */

const FAKE_NOW = new Date("2026-12-20T15:00:00.000Z")
const TODAY = "2026-12-20"

/**
 * Tope de filas del libro, mutable para probar el truncado sin sembrar 20.000 trabajos (la constante de
 * producción es `HISTORY_MAX_ROWS = 20_000`; el mock sólo cambia su valor, la lógica de corte es la real).
 */
const cap = vi.hoisted(() => ({ max: 20_000 }))
vi.mock("@/lib/mantencion/history-view", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/mantencion/history-view")>()
  return { ...original, get HISTORY_MAX_ROWS() { return cap.max } }
})

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __historyExportDb?: DB }
testGlobal.__historyExportDb = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__historyExportDb }, get Tx() { return undefined } }))

const { exportHistory, HISTORY_EXPORT_HEADERS } = await import("@/lib/services/mantencion/export-history")
const { filterHistoryRows, parseHistoryParams, sortHistoryRows } = await import("@/lib/mantencion/history-view")
const { loadMaintenanceHistory } = await import("@/lib/services/mantencion/maintenance-work")
const { viewerFromSession } = await import("@/lib/services/mantencion/access")
const { resolveHistoricalWorksiteFilter } = await import("@/lib/services/mantencion/historical-import")

// ── Identificadores y alcance ───────────────────────────────────────────────

const WS = { a: "ws-hx-a", b: "ws-hx-b" } as const
const V = { a: "v-hx-a", b: "v-hx-b" } as const
const WK = "wk-hx"
const U = { jefe: "u-hx-jefe", sup: "u-hx-sup", rec: "u-hx-rec", mech: "u-hx-mech", own: "u-hx-own" } as const
const EQUIPMENT: Record<string, { code: string; plate: string }> = {
  [V.a]: { code: "KA-HX1", plate: "HXA-001" },
  [V.b]: { code: "KB-HX1", plate: "HXB-001" },
}

/** Sesión tal como la arma `auth()`: lo que el servicio lee de `session.user`. */
const sessionOf = (id: string, permissions: string[], worksiteIds: string[] = [], isGlobal = false): Session =>
  ({ user: { id, email: `${id}@chome.test`, name: id, isGlobal, worksiteIds, permissions } }) as unknown as Session

/** Jefatura global: todo el historial, con OT. */
const JEFE = sessionOf(U.jefe, ["mant:export", "mant:records:view_all", "mant:ot:view_all"], [], true)
/** Ve todas las faenas pero no es rol global (`view_all` sin `isGlobal`). */
const VIEW_ALL = sessionOf(U.jefe, ["mant:export", "mant:records:view_all", "mant:ot:view_all"])
/** Supervisor de la faena A con lectura de registros y de OT de su faena. */
const SUP_A = sessionOf(U.sup, ["mant:export", "mant:records:view_worksite", "mant:ot:view_worksite"], [WS.a])
/** Sólo registros de su faena: sin permiso de OT, así que el libro no trae OT y lo dice. */
const RECORDS_A = sessionOf(U.rec, ["mant:export", "mant:records:view_worksite"], [WS.a])
/** Puede administrar equipos de su faena, pero no leer el historial. */
const NO_READ = sessionOf(U.sup, ["mant:export", "mant:equipment:manage"], [WS.a])
/** Sólo lo que registró él mismo: no es lectura del historial de ninguna faena. */
const OWN_ONLY = sessionOf(U.own, ["mant:export", "mant:records:view_own"], [WS.a])
/** Ve las OT pero no los registros: tampoco basta para el historial. */
const ORDERS_ONLY = sessionOf(U.sup, ["mant:export", "mant:ot:view_all"], [WS.a])

// ── Fechas y resultados esperados ───────────────────────────────────────────

const PARAMS = parseHistoryParams({ desde: "2026-11-01", hasta: "2026-12-31" }, TODAY)
const day = (plain: string) => new Date(`${plain}T00:00:00.000Z`)

/** Referencias (columna «Referencia») de cada trabajo sembrado: `MT-` formulario, `OT-` orden, `MR-` registro. */
const REF = {
  hA1: "MT-hx-a1", hA2: "MT-hx-a2", hB1: "MT-hx-b1", hNoEq: "MT-hx-noeq", hInj: "MT-hx-inj",
  otA1: "OT-HXA1", otExt: "OT-HXEXT",
  rPA: "MR-HXPA", rCA: "MR-HXCA", rCOpen: "MR-HXCO", rPB: "MR-HXPB",
} as const

/** Todo lo que debe salir para jefatura entre noviembre y el día de hoy (11 trabajos). */
const ALL_REFS: string[] = [REF.hA1, REF.hA2, REF.hB1, REF.hNoEq, REF.hInj, REF.otA1, REF.otExt, REF.rPA, REF.rCA, REF.rCOpen, REF.rPB].sort()
/** Lo que ve el supervisor de A: ni el formulario, ni la OT ni el registro de B quedan fuera (8 trabajos). */
const SUP_A_REFS: string[] = [REF.hA1, REF.hA2, REF.hInj, REF.hNoEq, REF.otA1, REF.rPA, REF.rCA, REF.rCOpen].sort()
/** Sólo la faena B (3 trabajos). */
const B_REFS: string[] = [REF.hB1, REF.otExt, REF.rPB].sort()
/** Sin OT: lo que ve quien lee registros e historial pero no órdenes (7 trabajos). */
const RECORDS_A_REFS: string[] = [REF.hA1, REF.hA2, REF.hInj, REF.hNoEq, REF.rPA, REF.rCA, REF.rCOpen].sort()

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
  /** Texto del campo EXTERNO del formulario (lo lee el libro como «Taller o ejecutor externo»). */
  external?: string
  isTest?: boolean
}

const HISTORIAL: HistoricalSeed[] = [
  // Vinculada, con todo: taller externo con nombre, contrato, observación y horas.
  { key: "hx-a1", vehicleId: V.a, worksiteId: WS.a, entryDate: "2026-11-10", exitDate: "2026-11-12", submittedAt: "2026-11-08 10:00:00", kindText: "ACCION CORRECTIVA", description: "Cambio de bomba de agua", readingText: "12.345 km", orderText: "OC-77", laborHours: 4.5, specialties: ["mecanica"], contractText: "Residuos", qualityNotes: "Revisar lectura", external: "MAESTRANZA MELO" },
  // Vinculada, preventiva, sin horas y con taller interno («NO»).
  { key: "hx-a2", vehicleId: V.a, worksiteId: WS.a, entryDate: "2026-11-18", kindText: "ACCION PREVENTIVA", description: "Revisión de luces", external: "NO", specialties: ["electrica"] },
  // Vinculada a B, con taller sin informar y dos especialidades.
  { key: "hx-b1", vehicleId: V.b, worksiteId: WS.b, entryDate: "2026-11-20", actionType: "correctiva", description: "Falla de frenos en B", specialties: ["mecanica", "soldadura"], laborHours: 1 },
  // Sin equipo vinculado: sale con el texto del formulario como equipo.
  { key: "hx-noeq", worksiteId: WS.a, entryDate: "2026-11-22", kindText: "ACCION CORRECTIVA", description: "Trabajo sin equipo vinculado", equipmentText: "Equipo sin vincular" },
  // Texto que empieza con =, +, - y @ en cuatro columnas: tiene que salir como texto, nunca como fórmula.
  { key: "hx-inj", vehicleId: V.a, worksiteId: WS.a, entryDate: "2026-11-12", description: "=1+1", readingText: "+5 km", orderText: "-12", qualityNotes: "@cmd" },
  // Respuesta de prueba: nunca sale.
  { key: "hx-test", vehicleId: V.a, worksiteId: WS.a, entryDate: "2026-11-15", description: "Respuesta de prueba", isTest: true },
  // Respuesta posterior al corte: se guarda, pero no entra en el historial de las cifras.
  { key: "hx-late", vehicleId: V.a, worksiteId: WS.a, entryDate: "2026-12-03", description: "Respuesta posterior al corte" },
]
type OrderInsert = typeof schema.mantWorkOrders.$inferInsert
/** Una OT con los datos comunes (solicitud de jefatura el 19-11) y lo que cada caso necesita. */
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
/** Un registro firmado por el mecánico en su propia faena. */
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

const ORDERS: OrderInsert[] = [
  // Entró a taller el 20-11 y salió el 24-11: correctiva interna con lecturas de ingreso (cuenta aunque sea anterior al corte).
  orderRow({
    id: "o-hx-a1", folio: REF.otA1, vehicleId: V.a, worksiteId: WS.a, status: "trabajo_terminado", repair: true, actionType: "correctiva",
    repairDescription: "Compresor", workPerformed: "Reparación de compresor en A", specialties: ["mecanica"], laborHours: 6, workshopKind: "interno",
    workshopEntryAt: "2026-11-20T15:00:00Z", workshopExitAt: "2026-11-24T15:00:00Z", finishedAt: "2026-11-24T16:00:00Z", finishedByUserId: U.mech,
    startedAt: "2026-11-20T16:00:00Z", startedByUserId: U.mech, estimatedDeliveryDate: "2026-11-24",
    assignedToUserId: U.mech, assignedByUserId: U.jefe, assignedAt: "2026-11-19T12:00:00Z", entryOdometer: 12345, entryHourmeter: 1234,
  }),
  // Externa, de la faena B, del equipo B: entró y salió de taller.
  orderRow({
    id: "o-hx-ext", folio: REF.otExt, vehicleId: V.b, worksiteId: WS.b, status: "trabajo_terminado", repair: true, actionType: "correctiva",
    repairDescription: "Hidráulica", workPerformed: "Reparación hidráulica externa", specialties: ["hidraulica"], laborHours: 3, workshopKind: "externo", workshopId: WK,
    workshopName: "Taller Externo HX", workshopEntryAt: "2026-11-16T15:00:00Z", workshopExitAt: "2026-11-18T15:00:00Z",
    finishedAt: "2026-11-18T16:00:00Z", finishedByUserId: U.mech, startedAt: "2026-11-16T16:00:00Z", startedByUserId: U.mech,
    estimatedDeliveryDate: "2026-11-18", assignedToUserId: U.mech, assignedByUserId: U.jefe, assignedAt: "2026-11-15T12:00:00Z",
  }),
  // Anulada, pero con ingreso a taller: tiene que caer por el estado.
  orderRow({
    id: "o-hx-void", folio: "OT-HXVOID", vehicleId: V.a, worksiteId: WS.a, status: "anulada", repair: true, actionType: "correctiva",
    repairDescription: "Embrague", workshopKind: "interno", workshopEntryAt: "2026-11-21T15:00:00Z", voidedAt: "2026-11-22T12:00:00Z", voidedByUserId: U.jefe, voidReason: "Pedida por error",
  }),
]

const RECORDS: RecordInsert[] = [
  // Preventiva firmada después del corte y sin OT: entra.
  recordRow({
    id: "hx-p-a", folio: REF.rPA, kind: "P", vehicleId: V.a, worksiteId: WS.a, workDate: "2026-12-02", reading: 12345,
    scheduleVersion: 1, scheduleNameSnapshot: "40.000 km", intervalValue: 40_000, suggestedIntervalValue: 40_000, notes: "Sin novedad",
  }),
  // Correctiva de taller externo, ya con salida: entra con sus días y su salida.
  recordRow({
    id: "hx-c-a", folio: REF.rCA, kind: "C", vehicleId: V.a, worksiteId: WS.a, workDate: "2026-12-04", reading: 500,
    executorKind: "externo", executorUserId: null, executorWorkshopId: WK, executorName: "Taller Externo HX",
  }),
  // Correctiva en taller hoy (sin salida): cuenta hasta HOY (20-12) = 10 días.
  recordRow({ id: "hx-c-open", folio: REF.rCOpen, kind: "C", vehicleId: V.a, worksiteId: WS.a, workDate: "2026-12-10", reading: 9000 }),
  // Preventiva de la faena B, después del corte: sólo la ven quienes ven B.
  recordRow({
    id: "hx-p-b", folio: REF.rPB, kind: "P", vehicleId: V.b, worksiteId: WS.b, workDate: "2026-12-05", reading: 500,
    scheduleVersion: 1, scheduleNameSnapshot: "250 h", intervalValue: 250, suggestedIntervalValue: 250, notes: "Cambio de filtros",
  }),
  // Correctiva sin OT anterior al corte: no entra ni en la lista ni en el libro (antes del corte, un registro sin OT no cuenta).
  recordRow({ id: "hx-c-old", folio: "MR-HXOLD", kind: "C", vehicleId: V.a, worksiteId: WS.a, workDate: "2026-11-25", reading: 8000 }),
]

// ── Siembra ─────────────────────────────────────────────────────────────────

async function insertHistorical(seed: HistoricalSeed) {
  await testDb.insert(schema.mantHistoricalRecords).values({
    sourceKey: seed.key,
    fingerprint: `fp-${seed.key}`,
    sourceFile: "consolidado.xlsx",
    sourceSheet: "MANTENCIONES",
    sourceRow: 2,
    submittedAt: seed.submittedAt ?? `${seed.entryDate} 10:00:00`,
    worksiteText: seed.worksiteId === WS.a ? "Faena HX A" : seed.worksiteId === WS.b ? "Faena HX B" : "Faena sin conciliar",
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

beforeAll(async () => {
  // Sólo `Date`: ver la cabecera del archivo.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(FAKE_NOW)
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values(Object.values(U).map((id) => ({
    id, name: id, email: `${id}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
  })))
  const worksite = (id: string, name: string, code: string) => ({ id, name, code, isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([worksite(WS.a, "Faena HX A", "HX-A"), worksite(WS.b, "Faena HX B", "HX-B")])
  await testDb.insert(schema.mantWorksiteSettings).values([{ worksiteId: WS.a, folioCode: "HXA" }, { worksiteId: WS.b, folioCode: "HXB" }])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-hx", slug: "hx-camion", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.fuelVehicles).values([V.a, V.b].map((id) => ({
    id, code: EQUIPMENT[id]!.code, plate: EQUIPMENT[id]!.plate, type: "Camión", equipmentTypeId: "fet-hx",
    worksiteId: id === V.a ? WS.a : WS.b, model: "R450", year: 2021, brand: "Scania",
  })))
  await testDb.insert(schema.mantWorkshops).values({ id: WK, name: "Taller Externo HX", nameKey: "taller externo hx" })
  for (const seed of HISTORIAL) await insertHistorical(seed)
  await testDb.insert(schema.mantWorkOrders).values(ORDERS)
  await testDb.insert(schema.mantRecords).values(RECORDS)
  await testDb.insert(schema.mantRecordCorrectives).values([
    { recordId: "hx-c-a", workTypes: ["Frenos"], oils: [], description: "Cambio de sensor de temperatura", hours: 2, inWorkshop: true, workshopEntryDate: "2026-12-04", workshopReason: "Espera de repuesto" },
    { recordId: "hx-c-open", workTypes: ["Motor"], oils: [], description: "Cambio de bomba en taller", hours: 1.5, inWorkshop: true, workshopEntryDate: "2026-12-10", workshopReason: "Espera de repuesto" },
    { recordId: "hx-c-old", workTypes: ["Motor"], oils: [], description: "Correctiva anterior al corte", hours: 1, inWorkshop: false },
  ])
  await testDb.insert(schema.mantWorkshopUpdates).values({
    id: "wu-hx-c-a", recordId: "hx-c-a", kind: "salio", exitDate: "2026-12-07", userId: U.mech, createdAt: "2026-12-07T15:00:00Z",
  })
})

afterAll(() => {
  vi.useRealTimers()
})

// ── Ayudas ──────────────────────────────────────────────────────────────────

type ExportedOk = Extract<ExportOutcome, { ok: true }>

/** Libro de un resultado exitoso, leído desde el base64 tal como lo descarga el navegador. */
async function bookOf(outcome: ExportOutcome): Promise<ExcelJS.Workbook> {
  if (!outcome.ok) throw new Error(`no hubo libro: ${outcome.message}`)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from((outcome as ExportedOk).data.base64, "base64") as unknown as ArrayBuffer)
  return workbook
}

/** Filas de datos de una hoja como objetos por encabezado. Una celda vacía vale `null`, o `""` si se escribió vacía. */
function rowsOf(workbook: ExcelJS.Workbook, name = "Historial"): Array<Record<string, ExcelJS.CellValue>> {
  const sheet = workbook.getWorksheet(name)
  if (!sheet) throw new Error(`falta la hoja ${name}`)
  const rows: Array<Record<string, ExcelJS.CellValue>> = []
  sheet.eachRow((row, number) => {
    if (number === 1) return
    const record: Record<string, ExcelJS.CellValue> = {}
    HISTORY_EXPORT_HEADERS.forEach((header, index) => { record[header] = row.getCell(index + 1).value })
    rows.push(record)
  })
  return rows
}

const refsOfBook = (workbook: ExcelJS.Workbook) => rowsOf(workbook).map((row) => String(row["Referencia"])).sort()
const isEmpty = (value: ExcelJS.CellValue | undefined) => value === null || value === undefined || value === ""

/** Exporta y devuelve la hoja «Historial» como filas; falla si el libro no salió. */
async function historialOf(session: Session, params: HistoryParams) {
  return rowsOf(await bookOf(await exportHistory({ session, params })))
}

/** Metadatos como pares etiqueta/valor, en el orden de la hoja. */
function metadataOf(workbook: ExcelJS.Workbook): Array<[string, string]> {
  const sheet = workbook.getWorksheet("Metadatos")
  if (!sheet) throw new Error("falta la hoja Metadatos")
  const entries: Array<[string, string]> = []
  sheet.eachRow((row) => entries.push([String(row.getCell(1).value ?? ""), String(row.getCell(2).value ?? "")]))
  return entries
}
const metaValues = (entries: Array<[string, string]>, label: string) => entries.filter(([name]) => name === label).map(([, value]) => value)

async function exportAuditIds(): Promise<string[]> {
  const rows = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_history_export"))
  return rows.map((row) => row.id)
}

// ── Pruebas ─────────────────────────────────────────────────────────────────

describe("autorización: sólo quien lee el historial de sus faenas o de todas obtiene libro", () => {
  it("con mant:export y alcance de equipos, pero sin lectura del historial: «Sin permisos» y ninguna bitácora", async () => {
    const before = await exportAuditIds()
    const out = await exportHistory({ session: NO_READ, params: PARAMS })
    expect(out).toEqual({ ok: false, message: "Sin permisos" })
    expect(await exportAuditIds()).toEqual(before)
  })

  it.each([
    ["sólo sus propios registros (view_own)", OWN_ONLY],
    ["sólo órdenes de trabajo (mant:ot:view_all)", ORDERS_ONLY],
  ] as Array<[string, Session]>)("%s: «Sin permisos» y ninguna bitácora", async (_label, session) => {
    const before = await exportAuditIds()
    expect(await exportHistory({ session, params: PARAMS })).toEqual({ ok: false, message: "Sin permisos" })
    expect(await exportAuditIds()).toEqual(before)
  })

  it("con view_worksite o view_all obtiene libro; sin permiso de OT, el libro no trae OT", async () => {
    const withSupervisor = await exportHistory({ session: SUP_A, params: PARAMS })
    expect(withSupervisor.ok).toBe(true)
    expect(refsOfBook(await bookOf(withSupervisor))).toEqual(SUP_A_REFS)

    const records = await exportHistory({ session: RECORDS_A, params: PARAMS })
    expect(records.ok).toBe(true)
    expect(refsOfBook(await bookOf(records))).toEqual(RECORDS_A_REFS)

    const everything = await exportHistory({ session: VIEW_ALL, params: PARAMS })
    expect(everything.ok).toBe(true)
    expect(refsOfBook(await bookOf(everything))).toEqual(ALL_REFS)
  })
})

describe("alcance por faena", () => {
  it("un supervisor de la faena A exporta sólo trabajos de A: ni el formulario, ni la OT ni el registro de B", async () => {
    const rows = await historialOf(SUP_A, PARAMS)
    expect(rows.map((row) => String(row["Referencia"])).sort()).toEqual(SUP_A_REFS)
    expect(new Set(rows.map((row) => row["Faena"]))).toEqual(new Set(["Faena HX A"]))
  })

  it("con view_all exporta A y B", async () => {
    const rows = await historialOf(VIEW_ALL, PARAMS)
    expect(rows.map((row) => String(row["Referencia"])).sort()).toEqual(ALL_REFS)
    expect(new Set(rows.map((row) => row["Faena"]))).toEqual(new Set(["Faena HX A", "Faena HX B"]))
  })

  it("con ?faena=B la jefatura obtiene sólo la faena B", async () => {
    const rows = await historialOf(JEFE, parseHistoryParams({ faena: WS.b, desde: "2026-11-01", hasta: "2026-12-31" }, TODAY))
    expect(rows.map((row) => String(row["Referencia"])).sort()).toEqual(B_REFS)
  })

  it("con ?equipo= la jefatura obtiene sólo ese equipo (los tres trabajos del equipo B)", async () => {
    const rows = await historialOf(JEFE, parseHistoryParams({ equipo: V.b, desde: "2026-11-01", hasta: "2026-12-31" }, TODAY))
    expect(rows.map((row) => String(row["Referencia"])).sort()).toEqual(B_REFS)
  })

  it("con ?equipo= de un equipo de la faena B, el supervisor de A no recibe ninguna de sus filas", async () => {
    const params = parseHistoryParams({ equipo: V.b, desde: "2026-11-01", hasta: "2026-12-31" }, TODAY)
    const out = await exportHistory({ session: SUP_A, params })
    const refs = out.ok ? refsOfBook(await bookOf(out)) : []
    expect(refs.filter((ref) => B_REFS.includes(ref))).toEqual([])
  })

  it("con ?faena= de otra faena el supervisor de A no recibe ninguna fila de B", async () => {
    const params = parseHistoryParams({ faena: WS.b, desde: "2026-11-01", hasta: "2026-12-31" }, TODAY)
    const out = await exportHistory({ session: SUP_A, params })
    // Si el libro sale vacío o sólo con A, no hay fuga. Lo que no puede pasar es que salga B.
    const refs = out.ok ? refsOfBook(await bookOf(out)) : []
    expect(refs.filter((ref) => B_REFS.includes(ref))).toEqual([])
  })

  it("?faena= fuera de alcance: la lista y el libro la tratan igual, como «sin filtro» (no como un libro vacío)", async () => {
    const params = parseHistoryParams({ faena: WS.b, desde: "2026-11-01", hasta: "2026-12-31" }, TODAY)
    const viewer = viewerFromSession(SUP_A)
    // Lo que pinta la lista (app/(app)/mantencion/registros/historicos/page.tsx): una faena fuera del alcance no llega al cargador.
    expect(await resolveHistoricalWorksiteFilter(viewer, params.worksiteId)).toBeNull()
    const listed = (await loadMaintenanceHistory(viewer, { from: params.from, to: params.to, today: TODAY })).rows
    const expected = sortHistoryRows(filterHistoryRows(listed, { ...params, worksiteId: "" }), params.sort, params.dir).map((row) => row.reference)
    expect(expected).toHaveLength(SUP_A_REFS.length)
    // El libro sale con lo mismo que la lista (antes: «No hay trabajos para exportar con estos filtros.»).
    const out = await exportHistory({ session: SUP_A, params })
    expect(out.ok).toBe(true)
    if (out.ok) expect(rowsOf(await bookOf(out)).map((row) => String(row["Referencia"]))).toEqual(expected)
  })
})

describe("mismas filas que la lista", () => {
  it("para jefatura y supervisor, el libro trae las mismas filas, en el mismo orden, que la lista con sus filtros", async () => {
    for (const session of [JEFE, SUP_A]) {
      const viewer = viewerFromSession(session)
      const listed = (await loadMaintenanceHistory(viewer, { from: PARAMS.from, to: PARAMS.to, today: TODAY })).rows
      const expected = sortHistoryRows(filterHistoryRows(listed, PARAMS), PARAMS.sort, PARAMS.dir).map((row) => row.reference)
      const exported = rowsOf(await bookOf(await exportHistory({ session, params: PARAMS }))).map((row) => String(row["Referencia"]))
      expect(exported).toHaveLength(expected.length)
      expect(exported).toEqual(expected)
    }
  })

  it("respeta el corte, las pruebas y las OT anuladas; sí trae la OT que entró a taller y la respuesta antes del corte", async () => {
    const refs = (await historialOf(JEFE, PARAMS)).map((row) => String(row["Referencia"]))
    for (const forbidden of ["MT-hx-test", "MT-hx-late", "OT-HXVOID", "MR-HXOLD"]) expect(refs).not.toContain(forbidden)
    expect(refs).toContain(REF.otA1)
    expect(refs).toContain(REF.hA1)
    expect(refs.sort()).toEqual(ALL_REFS)
  })
})

describe("filtros que el servidor vuelve a leer", () => {
  it.each([
    ["origen=ot", { origen: "ot" }, [REF.otA1, REF.otExt].sort()],
    ["tipo=correctiva", { tipo: "correctiva" }, [REF.hA1, REF.hB1, REF.hNoEq, REF.otA1, REF.otExt, REF.rCA, REF.rCOpen].sort()],
    ["taller=externo", { taller: "externo" }, [REF.hA1, REF.otExt, REF.rCA].sort()],
    ["especialidad=mecanica", { especialidad: "mecanica" }, [REF.hA1, REF.hB1, REF.otA1].sort()],
    ["q=revision (sin acentos)", { q: "revision" }, [REF.hA2]],
    ["q=hxa-001 (por la patente)", { q: "hxa-001" }, [REF.hA1, REF.hA2, REF.hInj, REF.otA1, REF.rPA, REF.rCA, REF.rCOpen].sort()],
  ] as Array<[string, Record<string, string>, string[]]>)("%s deja sólo las filas que deja la lista", async (_label, filter, expected) => {
    const params = parseHistoryParams({ desde: "2026-11-01", hasta: "2026-12-31", ...filter }, TODAY)
    const listed = (await loadMaintenanceHistory(viewerFromSession(JEFE), { from: params.from, to: params.to, today: TODAY })).rows
    const fromList = filterHistoryRows(listed, params).map((row) => row.reference).sort()
    expect(fromList).toEqual(expected)
    const exported = (await historialOf(JEFE, params)).map((row) => String(row["Referencia"])).sort()
    expect(exported).toEqual(expected)
  })

  it("orden=horas&dir=asc: el libro sigue ese orden y lo que no tiene horas va al final, vacío", async () => {
    const params = parseHistoryParams({ desde: "2026-11-01", hasta: "2026-12-31", orden: "horas", dir: "asc" }, TODAY)
    const rows = await historialOf(JEFE, params)
    const hours = rows.map((row) => row["Horas hombre"])
    const withHours = hours.filter((value) => !isEmpty(value))
    expect(withHours).toEqual([1, 1.5, 2, 3, 4.5, 6])
    expect(hours.slice(withHours.length).every((value) => isEmpty(value))).toBe(true)
    expect(hours.slice(withHours.length)).toHaveLength(ALL_REFS.length - withHours.length)
    // Y es el mismo orden que la lista.
    const listed = (await loadMaintenanceHistory(viewerFromSession(JEFE), { from: params.from, to: params.to, today: TODAY })).rows
    const expected = sortHistoryRows(filterHistoryRows(listed, params), "horas", "asc").map((row) => row.reference)
    expect(rows.map((row) => String(row["Referencia"]))).toEqual(expected)
  })
})

describe("celdas del libro", () => {
  it("encabezados exactos y la hoja «Historial» primero", async () => {
    const book = await bookOf(await exportHistory({ session: JEFE, params: PARAMS }))
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Historial", "Metadatos"])
    const headers = (book.getWorksheet("Historial")!.getRow(1).values as unknown[]).slice(1)
    expect(headers).toEqual([...HISTORY_EXPORT_HEADERS])
  })

  it("formulario vinculado: origen, tipo, trabajo, lectura, horas, fechas, taller, especialidades, contrato y observación", async () => {
    const row = rowsOf(await bookOf(await exportHistory({ session: JEFE, params: PARAMS }))).find((item) => item["Referencia"] === REF.hA1)!
    expect(row).toMatchObject({
      "Fecha": day("2026-11-10"),
      "Equipo": "KA-HX1 · HXA-001",
      "Faena": "Faena HX A",
      "Origen": "Formulario",
      "Referencia": "MT-hx-a1",
      "Nº de orden": "OC-77",
      "Tipo": "Correctiva",
      "Trabajo": "Cambio de bomba de agua",
      "Lectura": "12.345 km",
      "Horas hombre": 4.5,
      "Ingreso a taller": day("2026-11-10"),
      "Salida de taller": day("2026-11-12"),
      "Días en taller": 2,
      "En taller": "No",
      "Taller externo": "Sí",
      "Taller o ejecutor externo": "MAESTRANZA MELO",
      "Especialidades": "Mecánica",
      "Contrato": "Residuos",
      "Observación de calidad": "Revisar lectura",
    })
  })

  it("orden de trabajo y registro firmado: la misma estructura, con sus propios orígenes y lecturas", async () => {
    const rows = rowsOf(await bookOf(await exportHistory({ session: JEFE, params: PARAMS })))
    const byRef = (ref: string) => rows.find((item) => item["Referencia"] === ref)!

    expect(byRef(REF.otA1)).toMatchObject({
      "Origen": "Orden de trabajo", "Tipo": "Correctiva", "Trabajo": "Reparación de compresor en A", "Lectura": "12.345 km · 1.234 h",
      "Horas hombre": 6, "Ingreso a taller": day("2026-11-20"), "Salida de taller": day("2026-11-24"), "Días en taller": 4,
      "En taller": "No", "Taller externo": "No", "Especialidades": "Mecánica",
    })
    expect(isEmpty(byRef(REF.otA1)["Contrato"])).toBe(true)
    expect(byRef(REF.otExt)).toMatchObject({
      "Faena": "Faena HX B", "Taller externo": "Sí", "Taller o ejecutor externo": "Taller Externo HX", "Especialidades": "Hidráulica", "Días en taller": 2,
    })
    expect(byRef(REF.rCA)).toMatchObject({
      "Origen": "Registro firmado", "Tipo": "Correctiva", "Trabajo": "Cambio de sensor de temperatura", "Lectura": "500 km",
      "Horas hombre": 2, "Ingreso a taller": day("2026-12-04"), "Salida de taller": day("2026-12-07"), "Días en taller": 3,
      "En taller": "No", "Taller externo": "Sí", "Taller o ejecutor externo": "Taller Externo HX",
    })
    // Un registro en taller hoy: sin salida, cuenta hasta el día del libro (20-12).
    expect(byRef(REF.rCOpen)).toMatchObject({
      "Tipo": "Correctiva", "Ingreso a taller": day("2026-12-10"), "Días en taller": 10, "En taller": "Sí", "Taller externo": "No",
    })
    expect(isEmpty(byRef(REF.rCOpen)["Salida de taller"])).toBe(true)
    // Una preventiva de registro: su trabajo son la pauta y las notas; no tiene horas ni taller.
    expect(byRef(REF.rPA)).toMatchObject({
      "Origen": "Registro firmado", "Tipo": "Preventiva", "Trabajo": "40.000 km — Sin novedad", "Lectura": "12.345 km", "Taller externo": "No",
    })
    expect(isEmpty(byRef(REF.rPA)["Horas hombre"])).toBe(true)
  })

  it("equipo sin vincular sale con el texto del formulario; taller sin informar dice «No informado»", async () => {
    const rows = rowsOf(await bookOf(await exportHistory({ session: JEFE, params: PARAMS })))
    const byRef = (ref: string) => rows.find((item) => item["Referencia"] === ref)!
    expect(byRef(REF.hNoEq)).toMatchObject({ "Equipo": "Equipo sin vincular", "Faena": "Faena HX A", "Tipo": "Correctiva" })
    expect(byRef(REF.hB1)).toMatchObject({ "Taller externo": "No informado", "Especialidades": "Mecánica, Soldadura", "Faena": "Faena HX B" })
    expect(byRef(REF.hA2)).toMatchObject({ "Taller externo": "No", "Especialidades": "Eléctrica", "Tipo": "Preventiva" })
  })

  it("las horas sin dato quedan vacías, nunca en cero", async () => {
    const rows = rowsOf(await bookOf(await exportHistory({ session: JEFE, params: PARAMS })))
    const byRef = (ref: string) => rows.find((item) => item["Referencia"] === ref)!
    for (const ref of [REF.hA2, REF.hInj, REF.hNoEq, REF.rPA, REF.rPB]) {
      expect(isEmpty(byRef(ref)["Horas hombre"]), `${ref} tiene horas sin dato`).toBe(true)
    }
    expect(isEmpty(byRef(REF.hA2)["Días en taller"])).toBe(true)
  })

  it("fechas como celdas de fecha reales con formato dd-mm-yyyy, y lo vacío sin fecha", async () => {
    const book = await bookOf(await exportHistory({ session: JEFE, params: PARAMS }))
    const sheet = book.getWorksheet("Historial")!
    const columnOf = (name: string) => HISTORY_EXPORT_HEADERS.indexOf(name as (typeof HISTORY_EXPORT_HEADERS)[number]) + 1
    for (const name of ["Fecha", "Ingreso a taller", "Salida de taller"]) {
      const column = columnOf(name)
      sheet.eachRow((row, number) => {
        if (number === 1) return
        const cell = row.getCell(column)
        if (cell.value instanceof Date) expect(cell.numFmt, `${name} fila ${number}`).toBe("dd-mm-yyyy")
      })
    }
    const fecha = sheet.getRow(2).getCell(columnOf("Fecha"))
    expect(fecha.value).toBeInstanceOf(Date)
    // Una fila sin salida no tiene fecha de salida: la celda va vacía, no con una fecha inventada.
    const open = rowsOf(book).find((row) => row["Referencia"] === REF.hA2)!
    expect(isEmpty(open["Salida de taller"])).toBe(true)
  })

  it("ninguna celda es fórmula, aunque el texto empiece con = + - @; el texto sigue ahí", async () => {
    const book = await bookOf(await exportHistory({ session: JEFE, params: PARAMS }))
    let formulas = 0
    for (const sheet of book.worksheets) {
      sheet.eachRow((row) => row.eachCell((cell) => { if (cell.type === ExcelJS.ValueType.Formula) formulas += 1 }))
    }
    expect(formulas).toBe(0)
    const injected = rowsOf(book).find((row) => row["Referencia"] === REF.hInj)!
    // El saneado compartido (`sanitizeCell`, excel-builder.ts) guarda el texto con un apóstrofo delante: `'=1+1`.
    // Se afirma que el texto original sigue ahí y que no es fórmula; el apóstrofo visible es un hallazgo aparte.
    expect(String(injected["Trabajo"])).toContain("=1+1")
    expect(String(injected["Lectura"])).toContain("+5 km")
    expect(String(injected["Nº de orden"])).toContain("-12")
    expect(String(injected["Observación de calidad"])).toContain("@cmd")
  })
})

describe("bitácora", () => {
  it("un libro exitoso deja UNA fila de auditoría: quién, cuántas filas y el nombre del archivo", async () => {
    const before = new Set(await exportAuditIds())
    const out = await exportHistory({ session: JEFE, params: PARAMS })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const added = (await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_history_export")))
      .filter((row) => !before.has(row.id))
    expect(added).toHaveLength(1)
    const [entry] = added
    expect(entry).toMatchObject({ action: "export", entityType: "mant_history_export", userId: U.jefe, userEmail: `${U.jefe}@chome.test` })
    expect(entry!.entityId).not.toBe("")
    expect(JSON.parse(entry!.newState ?? "{}")).toMatchObject({ rowCount: ALL_REFS.length, truncated: false })
    // El reloj está fijado (ver la cabecera): el archivo lleva el día del libro, no el de la máquina.
    expect(out.data.filename).toBe(`historial-mantenciones-${TODAY}.xlsx`)
    expect(out.data.truncated).toBe(false)
  })
})

describe("metadatos del libro", () => {
  it("periodo=todo: nombra «Sin filtro» en el desde y no inventa un 01-01-2000", async () => {
    const params = parseHistoryParams({ periodo: "todo" }, TODAY)
    const entries = metadataOf(await bookOf(await exportHistory({ session: JEFE, params })))
    expect(metaValues(entries, "Período (desde)")).toEqual(["Sin filtro"])
    const everything = entries.map(([label, value]) => `${label} ${value}`).join("\n")
    expect(everything).not.toContain("2000")
    expect(everything).not.toContain("01-01-2000")
  })

  it("rango explícito: nombra desde y hasta, con el hasta recortado a hoy", async () => {
    const entries = metadataOf(await bookOf(await exportHistory({ session: JEFE, params: PARAMS })))
    expect(metaValues(entries, "Período (desde)")).toEqual(["2026-11-01"])
    expect(metaValues(entries, "Período (hasta)")).toEqual([TODAY])
    expect(metaValues(entries, "Filas incluidas")).toEqual([String(ALL_REFS.length)])
  })

  it("sin permiso de OT en su alcance, la nota lo dice; quien ve OT no recibe esa nota", async () => {
    const withoutOrders = metadataOf(await bookOf(await exportHistory({ session: RECORDS_A, params: PARAMS })))
    expect(metaValues(withoutOrders, "Nota").join("\n")).toContain("Tu perfil no ve todas las órdenes de trabajo de su alcance: este libro no las incluye.")
    const withOrders = metadataOf(await bookOf(await exportHistory({ session: JEFE, params: PARAMS })))
    expect(metaValues(withOrders, "Nota").join("\n")).not.toContain("Tu perfil no ve todas las órdenes")
  })

  it("las notas nombran el corte de los formularios con sus fechas (30-11 y 01-12)", async () => {
    expect(FORMS_LAST_COUNTED_DATE).toBe("2026-11-30")
    expect(FORMS_CUTOVER_DATE).toBe("2026-12-01")
    const notes = metaValues(metadataOf(await bookOf(await exportHistory({ session: JEFE, params: PARAMS }))), "Nota").join("\n")
    expect(notes).toContain("hasta el 30-11-2026")
    expect(notes).toContain("desde el 01-12-2026")
    expect(notes).toContain("sin anuladas ni filas de prueba")
  })

  it("«Filtros aplicados» no lista un filtro que no se aplicó (nada de «taller: null» sin filtro de taller)", async () => {
    const entries = metadataOf(await bookOf(await exportHistory({ session: JEFE, params: PARAMS })))
    const applied = metaValues(entries, "Filtros aplicados")
    expect(applied).toHaveLength(1)
    // Un filtro sin valor no figura como aplicado (antes salía '{"taller":null}').
    expect(JSON.parse(applied[0]!)).toEqual({})
  })
})

describe("tope de filas", () => {
  it("con pocas filas el libro no está truncado y no tiene hoja de advertencias", async () => {
    const out = await exportHistory({ session: JEFE, params: PARAMS })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.data.truncated).toBe(false)
    expect((await bookOf(out)).worksheets.map((sheet) => sheet.name)).not.toContain("Advertencias")
  })

  it("por encima del tope corta el libro, lo dice dentro del archivo y lo registra con el número de filas que trae", async () => {
    cap.max = 3
    try {
      const out = await exportHistory({ session: JEFE, params: PARAMS })
      expect(out.ok).toBe(true)
      if (!out.ok) return
      expect(out.data).toMatchObject({ truncated: true, rowLimit: 3 })
      const book = await bookOf(out)
      expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Historial", "Advertencias", "Metadatos"])
      const kept = rowsOf(book)
      expect(kept).toHaveLength(3)
      // Son las primeras tres en el orden del libro (fecha descendente), no tres cualesquiera.
      expect(kept.map((row) => String(row["Referencia"]))).toEqual([REF.rCOpen, REF.rPB, REF.rCA])
      // La hoja de advertencias tiene sus propios encabezados («Advertencia», «Detalle»): se lee tal cual.
      const warnings = book.getWorksheet("Advertencias")!
      expect([warnings.getRow(1).getCell(1).value, warnings.getRow(1).getCell(2).value]).toEqual(["Advertencia", "Detalle"])
      expect(String(warnings.getRow(2).getCell(1).value)).toBe("Archivo truncado")
      expect(String(warnings.getRow(2).getCell(2).value)).toContain("límite de 3 filas")
      expect(metaValues(metadataOf(book), "Filas incluidas")).toEqual(["3"])
    } finally {
      cap.max = 20_000
    }
  })
})
