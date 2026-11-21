import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { resolveIndicatorPeriod } from "@/lib/indicators/period"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import type { MantViewer } from "@/lib/services/mantencion/access"

/**
 * Tablero de mantención de Trinorma (R5) contra Postgres de verdad: los «trabajos de mantención» (historial de
 * formularios ∪ OT) sin doble conteo, sin filas de prueba y con alcance por faena; el % de correctivas con los
 * «sin clasificar» aparte; los días en taller; los hallazgos «mal estado» con y sin trabajo dentro del plazo;
 * el promedio de las pautas importadas y «Sin pauta definida».
 *
 * El «hoy» es fijo (2026-11-13) para que las cifras no dependan del día en que corre la prueba.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __tableroDb?: DB }
testGlobal.__tableroDb = testDb
vi.mock("@/lib/auth/can", () => ({
  can: (session: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(session?.user?.permissions?.includes(permission)),
}))
vi.mock("@/db", () => ({ get db() { return testGlobal.__tableroDb }, get Tx() { return undefined } }))

const {
  loadFindingsWithoutWork, loadMaintenanceWork, loadPanelEquipment, loadScheduleCompliance, resolvePanelEquipment,
  summarizeMaintenanceWork,
} = await import("@/lib/services/mantencion/maintenance-work")
const { loadPautaState } = await import("@/lib/services/mantencion/indicators")
const { externalFromHistorical } = await import("@/lib/services/mantencion/maintenance-work")
const { loadPanelReport } = await import("../../app/(print)/mantencion/informe/report-data")

const TODAY = "2026-11-13"
const period = resolveIndicatorPeriod({ desde: "2026-09-01", hasta: TODAY }, TODAY)
const QUERY = { from: period.from, to: period.to, today: TODAY }
const SUMMARY_QUERY = { from: period.from, to: period.to, chart: period.chart, today: TODAY }

const WS = { a: "ws-tab-a", b: "ws-tab-b" } as const
const V = { a1: "v-tab-a1", a2: "v-tab-a2", b1: "v-tab-b1" } as const
const U = { actor: "u-tab-actor", mech: "u-tab-mech" } as const

const GLOBAL: MantViewer = { userId: "u-tab-viewer", email: null, permissions: ["mant:records:view_all", "mant:ot:view_all"], worksiteIds: [], isGlobal: true }
const SCOPED_A: MantViewer = { userId: "u-tab-viewer", email: null, permissions: ["mant:records:view_worksite", "mant:ot:view_worksite"], worksiteIds: [WS.a], isGlobal: false }
// Sólo ve las OT que creó o tiene asignadas (sin permiso de faena/todas): su conteo sería parcial.
const OWN_OT: MantViewer = { userId: "u-tab-viewer", email: null, permissions: ["mant:records:view_worksite", "mant:ot:execute"], worksiteIds: [WS.a], isGlobal: false }
const NO_OT: MantViewer = { userId: "u-tab-viewer", email: null, permissions: ["mant:records:view_worksite"], worksiteIds: [WS.a], isGlobal: false }

const snapshot = (code: string, plate: string, worksite: string) => ({ code, plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite, unit: "km" as const })
const SNAP = { [V.a1]: snapshot("KA-A1", "AAAA-01", "Faena A"), [V.a2]: snapshot("KA-A2", "AAAA-02", "Faena A"), [V.b1]: snapshot("KA-B1", "BBBB-01", "Faena B") }

interface OtInput {
  id: string; vehicleId: string; worksiteId: string; requestDate: string; repair: boolean; maintenance: boolean
  status: "solicitada" | "en_ejecucion" | "cerrada" | "anulada"
  entryAt?: string; exitAt?: string; actionType?: string; laborHours?: number
}

async function insertOt(input: OtInput) {
  const idle = input.status === "solicitada" || input.status === "anulada"
  const inShop = input.status === "en_ejecucion" || input.status === "cerrada"
  const closed = input.status === "cerrada"
  await testDb.insert(schema.mantWorkOrders).values({
    id: input.id, folio: `OT-${input.id}`, vehicleId: input.vehicleId, worksiteId: input.worksiteId,
    equipmentSnapshot: SNAP[input.vehicleId as keyof typeof SNAP],
    repair: input.repair, maintenance: input.maintenance, requestDate: input.requestDate,
    requestedByUserId: U.actor, requesterName: "Solicitante de Prueba",
    repairDescription: input.repair ? "Reparación de prueba" : null,
    status: input.status,
    assignedToUserId: idle ? null : U.mech, assignedByUserId: idle ? null : U.mech, assignedAt: idle ? null : input.entryAt,
    ...(inShop ? { workshopKind: "interno", workshopEntryAt: input.entryAt, estimatedDeliveryDate: "2026-12-01", startedAt: input.entryAt, startedByUserId: U.mech } : {}),
    ...(closed
      ? {
          workshopExitAt: input.exitAt, finishedAt: input.exitAt, finishedByUserId: U.mech,
          receivedAt: input.exitAt, receiverName: "Recibe Taller", receivedByUserId: U.mech, receivedRecordedAt: input.exitAt,
          faenaReceivedAt: input.exitAt, faenaReceiverName: "Recibe Faena", faenaReceivedByUserId: U.mech, closedAt: input.exitAt,
        }
      : {}),
    ...(input.status === "anulada" ? { voidedAt: "2026-10-14T15:00:00Z", voidedByUserId: U.mech, voidReason: "Pedida por error" } : {}),
    ...(input.actionType ? { actionType: input.actionType } : {}),
    ...(input.laborHours !== undefined ? { laborHours: input.laborHours } : {}),
  })
}

interface HistInput {
  id: string; vehicleId: string | null; worksiteId: string | null; entry: string | null; exit?: string | null
  actionType?: string | null; kind?: string; labor?: number | null; isTest?: boolean; submitted?: string; external?: string
}

async function insertHistorical(input: HistInput) {
  await testDb.insert(schema.mantHistoricalRecords).values({
    sourceKey: `h-${input.id}`, fingerprint: `fp-${input.id}`, sourceFile: "consolidado.xlsx", sourceSheet: "MANTENCIONES", sourceRow: 2,
    submittedAt: input.submitted ?? `${input.entry ?? "2026-10-01"} 10:00:00`, worksiteText: "faena", worksiteId: input.worksiteId,
    equipmentText: input.vehicleId ? "KA" : "KA-DESCONOCIDO", vehicleId: input.vehicleId, equipmentMatch: input.vehicleId ? "linked" : "unmatched",
    orderText: "", kindText: input.kind ?? "", readingText: "", description: "Trabajo histórico",
    entryDate: input.entry, exitDate: input.exit ?? null, hoursText: "",
    fields: input.external !== undefined ? [{ header: "TALLER_EXTERNO", value: input.external }] : [], importedBy: U.actor,
    sourceRecordId: `MT-${input.id}`,
    actionType: input.actionType === undefined ? null : input.actionType, laborHours: input.labor ?? null, isTest: input.isTest ?? false,
  })
}

async function insertInspection(id: string, vehicleId: string | null, worksiteId: string, date: string) {
  await testDb.insert(schema.mantHistoricalInspections).values({
    sourceKey: `i-${id}`, fingerprint: `fp-i-${id}`, sourceFile: "consolidado.xlsx", sourceSheet: "INSPECCIONES", sourceRow: 2,
    submittedAt: `${date} 08:00:00`, inspectionDate: date, formKind: "CAMION", unitKind: "CAMION",
    equipmentText: vehicleId ? "KA" : "KA-DESCONOCIDO", vehicleId, equipmentMatch: vehicleId ? "linked" : "unmatched",
    worksiteText: "faena", worksiteId, fields: [], importedBy: U.actor,
  })
}

async function insertFinding(id: string, inspection: string, foundOn: string, item: string, condition = "mal") {
  await testDb.insert(schema.mantHistoricalFindings).values({
    sourceKey: `f-${id}`, inspectionSourceKey: `i-${inspection}`, sourceRow: 2, foundOn, section: "Frenos", item, condition,
  })
}

async function insertSchedule(id: string, vehicleId: string, worksiteId: string, performedOn: string, compliance: number | null, isTest = false) {
  await testDb.insert(schema.mantHistoricalScheduleChecks).values({
    sourceKey: `s-${id}`, fingerprint: `fp-s-${id}`, sourceFile: "consolidado.xlsx", sourceSheet: "PAUTAS_PREVENTIVAS", sourceRow: 2,
    submittedAt: `${performedOn} 09:00:00`, performedOn, formKind: "CAMIONES", scheduleLabel: "40.000 KM",
    equipmentText: "KA", vehicleId, equipmentMatch: "linked", worksiteText: "faena", worksiteId, compliance, isTest, fields: [], importedBy: U.actor,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values(
    Object.values(U).map((id) => ({ id, name: id, email: `${id}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })),
  )
  const worksite = (id: string, name: string) => ({ id, name, code: id.toUpperCase(), isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([worksite(WS.a, "Faena A"), worksite(WS.b, "Faena B")])
  await testDb.insert(schema.mantWorksiteSettings).values([{ worksiteId: WS.a, folioCode: "AAA" }, { worksiteId: WS.b, folioCode: "BBB" }])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-tab", slug: "tab-km", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.mantBrands).values({ id: "b-tab", name: "Scania", nameKey: "scania" })
  const vehicle = (id: string, code: string, plate: string, worksiteId: string) => ({ id, code, plate, type: "Camión", equipmentTypeId: "fet-tab", worksiteId, model: "R450", year: 2021, brand: "Scania" })
  await testDb.insert(schema.fuelVehicles).values([vehicle(V.a1, "KA-A1", "AAAA-01", WS.a), vehicle(V.a2, "KA-A2", "AAAA-02", WS.a), vehicle(V.b1, "KA-B1", "BBBB-01", WS.b)])
  // Con perfil y SIN pauta asignada: el semáforo los pone en «sin pauta».
  await testDb.insert(schema.mantEquipmentProfiles).values([V.a1, V.a2, V.b1].map((vehicleId) => ({ vehicleId, brandId: "b-tab" })))

  // Historial de formularios.
  await insertHistorical({ id: "1", vehicleId: V.a1, worksiteId: WS.a, entry: "2026-09-10", exit: "2026-09-14", actionType: "correctiva", labor: 6, external: "SI" })
  await insertHistorical({ id: "2", vehicleId: V.a1, worksiteId: WS.a, entry: "2026-10-05", actionType: null, kind: "ACCION PREVENTIVA", external: "NO" })
  await insertHistorical({ id: "3", vehicleId: V.a2, worksiteId: WS.a, entry: "2026-10-08", actionType: "sin_clasificar" })
  await insertHistorical({ id: "4", vehicleId: V.a1, worksiteId: WS.a, entry: "2026-10-09", actionType: "correctiva", isTest: true })
  await insertHistorical({ id: "5", vehicleId: V.b1, worksiteId: WS.b, entry: "2026-10-10", actionType: "correctiva", labor: 10 })
  await insertHistorical({ id: "6", vehicleId: null, worksiteId: null, entry: "2026-10-11", actionType: "correctiva" })
  await insertHistorical({ id: "7", vehicleId: V.a1, worksiteId: WS.a, entry: "2026-07-01", actionType: "correctiva" })
  // Sin fecha de ingreso: cuenta por el día del envío del formulario; con la salida antes del ingreso no hay días.
  await insertHistorical({ id: "8", vehicleId: V.a2, worksiteId: WS.a, entry: null, actionType: "preventiva", submitted: "2026-09-20 11:00:00" })
  await insertHistorical({ id: "9", vehicleId: V.a2, worksiteId: WS.a, entry: "2026-09-25", exit: "2026-09-20", actionType: "preventiva" })

  // Órdenes de trabajo.
  await insertOt({ id: "o1", vehicleId: V.a1, worksiteId: WS.a, requestDate: "2026-10-20", repair: true, maintenance: false, status: "cerrada", entryAt: "2026-10-20T12:00:00Z", exitAt: "2026-10-22T12:00:00Z", laborHours: 4 })
  await insertOt({ id: "o2", vehicleId: V.a2, worksiteId: WS.a, requestDate: "2026-10-13", repair: true, maintenance: false, status: "anulada" })
  await insertOt({ id: "o3", vehicleId: V.a2, worksiteId: WS.a, requestDate: "2026-11-03", repair: true, maintenance: false, status: "en_ejecucion", entryAt: "2026-11-04T12:00:00Z", actionType: "predictiva" })
  // 02:30 UTC del 21-10 son las 23:30 del 20-10 en Chile (UTC-3): la fecha del trabajo es el 20.
  await insertOt({ id: "o5", vehicleId: V.b1, worksiteId: WS.b, requestDate: "2026-10-22", repair: true, maintenance: false, status: "en_ejecucion", entryAt: "2026-10-21T02:30:00Z", actionType: "correctiva" })
  await insertOt({ id: "o4", vehicleId: V.b1, worksiteId: WS.b, requestDate: "2026-11-05", repair: false, maintenance: true, status: "solicitada" })

  // Inspecciones y hallazgos.
  await insertInspection("1", V.a1, WS.a, "2026-10-01")
  await insertInspection("2", V.a2, WS.a, "2026-10-02")
  await insertInspection("3", null, WS.a, "2026-10-03")
  await insertInspection("4", V.b1, WS.b, "2026-10-03")
  await insertFinding("1", "1", "2026-10-01", "Neumático delantero") // a1: la historial 2 ingresa el 10-05, dentro de 7 días
  await insertFinding("2", "2", "2026-10-12", "Freno de servicio") // a2: ni la OT anulada del 10-13 ni nada más: sin trabajo
  await insertFinding("2b", "2", "2026-10-12", "Luces traseras")
  await insertFinding("3", "4", "2026-10-03", "Espejo") // b1: la historial 5 ingresa el 10-10, el día 7: cuenta
  await insertFinding("4", "4", "2026-10-04", "Parabrisas", "regular") // no es «mal»
  await insertFinding("5", "1", "2026-11-10", "Cinturón") // a1: el plazo corre hasta el 17-11: aún no se acusa
  await insertFinding("6", "3", "2026-10-05", "Extintor") // equipo sin vincular: no se puede saber
  await insertFinding("8", "1", "2026-10-08", "Bocina") // a1: la historial 4 (de prueba, 10-09) no cuenta: sin trabajo

  // Pautas de formularios.
  await insertSchedule("1", V.a1, WS.a, "2026-10-05", 0.8)
  await insertSchedule("2", V.a1, WS.a, "2026-10-20", 1)
  await insertSchedule("3", V.a1, WS.a, "2026-10-21", 0, true)
  await insertSchedule("4", V.b1, WS.b, "2026-10-10", 0.5)
  await insertSchedule("5", V.a1, WS.a, "2026-07-01", 0.1)
  await insertSchedule("6", V.a2, WS.a, "2026-10-06", null)
}, 120_000)

describe("trabajos de mantención: unión sin doble conteo", () => {
  it("une historial y OT, sin las filas de prueba, las OT anuladas ni lo fuera del período", async () => {
    const { rows, includesOrders } = await loadMaintenanceWork(GLOBAL, QUERY)
    expect(includesOrders).toBe(true)
    const ids = rows.map((row) => row.id).sort()
    expect(ids).toEqual(["h:h-1", "h:h-2", "h:h-3", "h:h-5", "h:h-6", "h:h-8", "h:h-9", "ot:o1", "ot:o3", "ot:o4", "ot:o5"])
    // Ni la fila de prueba (4), ni la de julio (7), ni la OT anulada (o2).
    expect(ids).not.toContain("h:h-4")
    expect(ids).not.toContain("h:h-7")
    expect(ids).not.toContain("ot:o2")
  })

  it("no suma los registros firmados (`mant_records`) a los trabajos", async () => {
    await testDb.insert(schema.mantRecords).values({
      id: "rec-1", folio: "MR-rec-1", kind: "C", vehicleId: V.a1, equipmentSnapshot: SNAP[V.a1], worksiteId: WS.a,
      reading: 10_000, unit: "km", workDate: "2026-10-15", registeredBy: U.mech, executorKind: "yo", executorUserId: U.mech,
      executorName: "Mecánico", signedAt: "2026-10-15T15:00:00Z", receivedAt: "2026-10-15T15:00:00Z", status: "vigente",
    })
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    expect(rows).toHaveLength(11)
    await testDb.delete(schema.mantRecords).where(eq(schema.mantRecords.id, "rec-1"))
  })

  it("la fecha es el ingreso a taller y, si falta, el envío del formulario o la solicitud de la OT", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    const dateOf = (id: string) => rows.find((row) => row.id === id)?.date
    expect(dateOf("h:h-8")).toBe("2026-09-20") // sin ingreso: el día del envío
    expect(dateOf("ot:o1")).toBe("2026-10-20") // ingreso (hora de Chile)
    expect(dateOf("ot:o3")).toBe("2026-11-04") // ingreso, no la solicitud del 03-11
    expect(dateOf("ot:o4")).toBe("2026-11-05") // sin ingreso: la solicitud
    // Borde de hora: 02:30 UTC del 21-10 son las 23:30 del 20-10 en Chile; no es el 21 ni la solicitud (22).
    expect(dateOf("ot:o5")).toBe("2026-10-20")
  })

  it("el tipo sale del campo, de las casillas de la OT o del texto, y lo que no se sabe queda «sin clasificar»", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    const typeOf = (id: string) => rows.find((row) => row.id === id)?.actionType
    expect(typeOf("h:h-1")).toBe("correctiva")
    expect(typeOf("h:h-2")).toBe("preventiva") // action_type null: «ACCION PREVENTIVA»
    expect(typeOf("h:h-3")).toBe("sin_clasificar")
    expect(typeOf("ot:o1")).toBe("correctiva") // sólo «Reparación»
    expect(typeOf("ot:o3")).toBe("predictiva") // el declarado manda
    expect(typeOf("ot:o4")).toBe("preventiva") // sólo «Mantención»
  })

  it("el taller externo se lee del formulario y no se inventa donde no se informa", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    const externalOf = (id: string) => rows.find((row) => row.id === id)?.external
    expect(externalOf("h:h-1")).toBe(true)
    expect(externalOf("h:h-2")).toBe(false)
    expect(externalOf("h:h-3")).toBeNull()
    expect(externalOf("ot:o1")).toBe(false) // taller interno
    expect(externalOf("ot:o4")).toBeNull() // sin ingreso aún
  })
})

describe("trabajos de mantención: días en taller", () => {
  it("salida − ingreso; sin fechas o con la salida antes del ingreso no hay cifra; la OT abierta cuenta hasta hoy", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    const row = (id: string) => rows.find((item) => item.id === id)!
    expect(row("h:h-1").workshopDays).toBe(4)
    expect(row("h:h-2").workshopDays).toBeNull() // sin salida
    expect(row("h:h-9").workshopDays).toBeNull() // salida anterior al ingreso: dato malo
    expect(row("ot:o1").workshopDays).toBe(2)
    expect(row("ot:o3")).toMatchObject({ workshopDays: 9, inWorkshop: true })
    expect(row("ot:o4").workshopDays).toBeNull()
    expect(row("ot:o5")).toMatchObject({ workshopDays: 24, inWorkshop: true })
    expect(row("h:h-1").inWorkshop).toBe(false)
  })

  it("el agregado suma sólo los trabajos con fechas y dice cuántos quedan sin ellas", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    const summary = summarizeMaintenanceWork(rows, SUMMARY_QUERY)
    expect(summary.workshopDays).toEqual({ total: 39, withData: 4, withoutData: 7, inWorkshop: 2 })
    expect(summary.laborHours).toEqual({ total: 20, withData: 3, withoutData: 8 })
    expect(summary.external).toBe(1)
  })
})

describe("trabajos de mantención: % de correctivas", () => {
  it("los «sin clasificar» van aparte y no entran en la base del porcentaje", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    const summary = summarizeMaintenanceWork(rows, SUMMARY_QUERY)
    expect(summary.total).toBe(11)
    expect(summary.byType).toEqual({ preventiva: 4, correctiva: 5, predictiva: 1, sin_clasificar: 1 })
    expect(summary.classified).toBe(10)
    expect(summary.correctivePercent).toBeCloseTo(50, 5)
    expect(summary.bySource).toEqual({ historial: 7, ot: 4 })
  })

  it("sin trabajos clasificados no hay porcentaje que inventar", () => {
    const summary = summarizeMaintenanceWork(
      [{ id: "x", source: "historial", reference: "", date: "2026-10-01", vehicleId: null, equipmentLabel: "KA", worksiteId: null, worksiteName: null, actionType: "sin_clasificar", laborHours: null, workshopDays: null, inWorkshop: false, external: null }],
      SUMMARY_QUERY,
    )
    expect(summary.correctivePercent).toBeNull()
    expect(summary.byType.sin_clasificar).toBe(1)
  })

  it("la serie por mes sigue la ventana de los gráficos y los equipos con más correctivas piden 2 o más", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    const summary = summarizeMaintenanceWork(rows, SUMMARY_QUERY)
    expect(summary.series.map((point) => [point.key, point.preventiva + point.correctiva + point.predictiva + point.sin_clasificar])).toEqual([
      ["2026-09", 3], ["2026-10", 6], ["2026-11", 2],
    ])
    expect(summary.series.at(-1)?.partial).toBe(true)
    // KA-A1 tiene 2 correctivas (historial 1 y la OT o1); los demás, una.
    expect(summary.topCorrective).toEqual([{ vehicleId: V.a1, label: "KA-A1 · AAAA-01", count: 2 }, { vehicleId: V.b1, label: "KA-B1 · BBBB-01", count: 2 }])
  })

  it("por faena: trabajos, correctivas, días y horas; lo que no tiene faena va aparte", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    const byWorksite = summarizeMaintenanceWork(rows, SUMMARY_QUERY).byWorksite
    const find = (name: string) => byWorksite.find((site) => site.name === name)
    expect(find("Faena A")).toMatchObject({ count: 7, correctives: 2, workshopDays: 15, laborHours: 10 })
    expect(find("Faena B")).toMatchObject({ count: 3, correctives: 2, workshopDays: 24, laborHours: 10 })
    expect(find("Sin faena")).toMatchObject({ count: 1, correctives: 1 })
  })
})

describe("alcance por faena", () => {
  it("un visor de faena sólo ve los trabajos de la suya; lo sin faena no se le muestra", async () => {
    const { rows } = await loadMaintenanceWork(SCOPED_A, QUERY)
    expect(rows.every((row) => row.worksiteId === WS.a)).toBe(true)
    expect(rows.map((row) => row.id)).not.toContain("h:h-6")
    expect(rows.map((row) => row.id)).not.toContain("h:h-5")
    expect(rows.map((row) => row.id)).not.toContain("ot:o4")
  })

  it("pedir una faena ajena no la abre; el filtro de faena sólo achica", async () => {
    expect((await loadMaintenanceWork(SCOPED_A, { ...QUERY, worksiteId: WS.b })).rows).toEqual([])
    expect((await loadMaintenanceWork(GLOBAL, { ...QUERY, worksiteId: WS.b })).rows.map((row) => row.id).sort()).toEqual(["h:h-5", "ot:o4", "ot:o5"])
  })

  it("sin permiso de OT las órdenes no entran y el resultado lo dice", async () => {
    const { rows, includesOrders } = await loadMaintenanceWork(NO_OT, QUERY)
    expect(includesOrders).toBe(false)
    expect(rows.every((row) => row.source === "historial")).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })

  it("el equipo elegido acota los trabajos, y uno fuera del alcance se ignora", async () => {
    expect((await loadMaintenanceWork(GLOBAL, { ...QUERY, vehicleId: V.a1 })).rows.map((row) => row.id).sort()).toEqual(["h:h-1", "h:h-2", "ot:o1"])
    expect(await resolvePanelEquipment(SCOPED_A, undefined, V.a1)).toMatchObject({ id: V.a1, label: "KA-A1 · AAAA-01" })
    expect(await resolvePanelEquipment(SCOPED_A, undefined, V.b1)).toBeNull()
    expect(await resolvePanelEquipment(GLOBAL, WS.b, V.a1)).toBeNull()
    expect(await resolvePanelEquipment(GLOBAL, undefined, "inventado")).toBeNull()
    expect((await loadPanelEquipment(SCOPED_A, undefined)).map((item) => item.id)).toEqual([V.a1, V.a2])
  })
})

describe("hallazgos «mal estado» sin trabajo", () => {
  it("cuenta con trabajo el del equipo dentro del plazo (el día N incluido) y sin trabajo el que no lo tiene", async () => {
    const result = await loadFindingsWithoutWork(GLOBAL, QUERY)
    expect(result.days).toBe(7)
    // Con equipo vinculado: 1, 2, 2b, 3, 5 y 8 (el 4 es «regular» y el 6 no tiene equipo).
    expect(result).toMatchObject({ total: 6, withWork: 2, inWindow: 1, withoutWork: 3, unlinked: 1 })
  })

  it("no cuenta como trabajo una OT anulada ni una fila de prueba, y agrupa por equipo", async () => {
    const result = await loadFindingsWithoutWork(GLOBAL, QUERY)
    expect(result.byEquipment.map((row) => [row.label, row.count])).toEqual([["KA-A2 · AAAA-02", 2], ["KA-A1 · AAAA-01", 1]])
    expect(result.byEquipment[0]).toMatchObject({ firstFoundOn: "2026-10-12", items: ["Frenos: Freno de servicio", "Frenos: Luces traseras"] })
  })

  it("respeta el alcance de faena y el equipo elegido", async () => {
    expect(await loadFindingsWithoutWork(SCOPED_A, QUERY)).toMatchObject({ total: 5, withWork: 1, withoutWork: 3 })
    expect(await loadFindingsWithoutWork(GLOBAL, { ...QUERY, vehicleId: V.a2 })).toMatchObject({ total: 2, withoutWork: 2, withWork: 0 })
  })

  it("quien no ve las OT no da por «sin trabajo» un hallazgo que sólo tiene una OT", async () => {
    // KA-A1: la OT o1 ingresó el 20-10; este hallazgo del 17-10 queda cubierto sólo por esa OT.
    await insertFinding("ot", "1", "2026-10-17", "Fuga de refrigerante")
    const withoutOrders = await loadFindingsWithoutWork(NO_OT, { ...QUERY, vehicleId: V.a1 })
    const withOrders = await loadFindingsWithoutWork(GLOBAL, { ...QUERY, vehicleId: V.a1 })
    expect(withoutOrders.withWork).toBe(2)
    expect(withOrders.withWork).toBe(2)
    expect(withoutOrders.byEquipment.flatMap((row) => row.items)).not.toContain("Frenos: Fuga de refrigerante")
    await testDb.delete(schema.mantHistoricalFindings).where(eq(schema.mantHistoricalFindings.sourceKey, "f-ot"))
  })
})

describe("pautas", () => {
  it("promedia el cumplimiento de las pautas importadas del período, sin las de prueba y sin las que no lo traen", async () => {
    expect(await loadScheduleCompliance(GLOBAL, QUERY)).toEqual({ checks: 4, withCompliance: 3, averagePercent: 76.7 })
    expect(await loadScheduleCompliance(SCOPED_A, QUERY)).toEqual({ checks: 3, withCompliance: 2, averagePercent: 90 })
    expect(await loadScheduleCompliance(GLOBAL, { ...QUERY, vehicleId: V.b1 })).toEqual({ checks: 1, withCompliance: 1, averagePercent: 50 })
  })

  it("sin pautas importadas en el período no hay promedio que inventar", async () => {
    expect(await loadScheduleCompliance(GLOBAL, { from: "2026-01-01", to: "2026-01-31", today: TODAY })).toEqual({ checks: 0, withCompliance: 0, averagePercent: null })
  })

  it("«Sin pauta definida» se cuenta como estado propio: nunca «al día» ni cero", async () => {
    const state = await loadPautaState(GLOBAL, undefined, TODAY)
    expect(state.total).toBe(3)
    expect(state.counts.sin_pauta).toBe(3)
    expect(state.counts.al_dia).toBe(0)
    const one = await loadPautaState(GLOBAL, undefined, TODAY, V.a1)
    expect(one.total).toBe(1)
    expect(one.counts.sin_pauta).toBe(1)
  })
})

describe("taller externo del historial", () => {
  it("los negativos explícitos son false, lo vacío o «no aplica» es null y cualquier otro texto (el nombre del taller) es true", () => {
    for (const value of ["NO", "no", " N ", "0", "FALSO", "INTERNO"]) expect(externalFromHistorical(value)).toBe(false)
    for (const value of [null, "", "  ", "N/A", "NA", "NO APLICA", "NINGUNO", "-"]) expect(externalFromHistorical(value)).toBeNull()
    for (const value of ["MAESTRANZA MELO", "SI", "Taller Perez"]) expect(externalFromHistorical(value)).toBe(true)
  })
})

describe("órdenes de trabajo: visibilidad completa o ninguna", () => {
  it("quien sólo ve sus propias OT no recibe un conteo parcial: se trata como «no ve OT»", async () => {
    const own = await loadMaintenanceWork(OWN_OT, QUERY)
    expect(own.includesOrders).toBe(false)
    expect(own.rows.every((row) => row.source === "historial")).toBe(true)
    expect((await loadMaintenanceWork(SCOPED_A, QUERY)).includesOrders).toBe(true)
    expect((await loadMaintenanceWork(GLOBAL, QUERY)).includesOrders).toBe(true)
  })
})

describe("informe PDF con un visor acotado a una faena", () => {
  const session = (permissions: string[], worksiteIds: string[]) => ({ user: { id: "u-tab-viewer", email: null, permissions, worksiteIds, isGlobal: false } })
  const scopedSession = session(["mant:records:view_worksite", "mant:ot:view_worksite", "mant:export"], [WS.a])
  // El informe toma «hoy» del reloj: se fija el mismo día que el resto de la suite.
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T15:00:00Z")) })
  afterEach(() => { vi.useRealTimers() })

  it("una faena o un equipo ajenos se ignoran y no se filtran trabajos ni hallazgos de la otra faena", async () => {
    const data = await loadPanelReport(scopedSession as never, { desde: "2026-09-01", hasta: TODAY, faena: WS.b, equipo: V.b1 })
    expect(data.worksiteId).toBeNull()
    expect(data.equipment).toBeNull()
    expect(data.worksiteName).toBe("Faena A")
    const summary = data.work!.summary
    expect(summary.byWorksite.map((site) => site.name)).toEqual(["Faena A"])
    expect(data.findings!.byEquipment.map((row) => row.label)).toEqual(["KA-A2 · AAAA-02", "KA-A1 · AAAA-01"])
    expect(data.findings!.byEquipment.every((row) => row.worksiteName === "Faena A")).toBe(true)
    expect(data.pautas!.total).toBe(2)
    expect(data.degraded).toEqual([])
  })

  it("un equipo de su faena sí acota el informe", async () => {
    const data = await loadPanelReport(scopedSession as never, { desde: "2026-09-01", hasta: TODAY, equipo: V.a2 })
    expect(data.equipment?.id).toBe(V.a2)
    expect(data.findings!.byEquipment.map((row) => row.label)).toEqual(["KA-A2 · AAAA-02"])
    expect(data.pautas!.total).toBe(1)
  })
})
