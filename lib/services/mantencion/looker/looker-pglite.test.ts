import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * SQL del tablero Looker contra Postgres de verdad: la unión de correctivas (histórico + OT +
 * registro), la paginación, el % de cumplimiento con corte histórico/nativo y la matriz de
 * checklist. Los datos son mínimos y fijos; no dependen del día en que corre la prueba.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { loadCorrectivePage, loadCorrectiveSummary } = await import("@/lib/services/mantencion/looker/corrective")
const { loadChecklistMatrix, loadComplianceChecks, loadPreventiveCompliance } = await import("@/lib/services/mantencion/looker/preventive")
const { loadLookerContext, loadLookerOptions } = await import("@/lib/services/mantencion/looker/resolve")
const { loadPlanningData } = await import("@/lib/services/mantencion/looker/planning")

const WS = "ws-looker"
const U = "u-looker"
const V = { hist: "v-looker-hist", ot: "v-looker-ot", rec: "v-looker-rec", hours: "v-looker-hours" } as const
const GLOBAL = { userId: U, email: null, permissions: ["mant:records:view_all", "mant:ot:view_all"], worksiteIds: [], isGlobal: true }
const SNAP = (code: string, plate: string) => ({ code, plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Faena Looker", unit: "km" as const })

const filters = (from: string, to: string, tab: "camiones" | "maquinas" = "camiones") => ({
  tab,
  from,
  to,
  requestedFrom: from,
  requestedTo: to,
  invalidPeriod: false,
  worksiteIds: [],
  equipmentIds: [],
  frequencies: [],
  page: 1,
  cross: {},
})

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: U, name: "Usuario Looker", email: `${U}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Looker", code: "LOOKER", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-looker", slug: "looker-km", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.mantBrands).values({ id: "b-looker", name: "Scania", nameKey: "scania" })
  await testDb.insert(schema.fuelVehicles).values([
    { id: V.hist, code: "KA-H", plate: "HIST-01", type: "Camión", equipmentTypeId: "fet-looker", worksiteId: WS, model: "R450", year: 2021, brand: "Scania" },
    { id: V.ot, code: "KA-OT", plate: "OT-01", type: "Camión", equipmentTypeId: "fet-looker", worksiteId: WS, model: "R450", year: 2021, brand: "Scania" },
    { id: V.rec, code: "KA-R", plate: "REC-01", type: "Camión", equipmentTypeId: "fet-looker", worksiteId: WS, model: "R450", year: 2021, brand: "Scania" },
  ])
  await testDb.insert(schema.mantEquipmentProfiles).values([V.hist, V.ot, V.rec].map((vehicleId) => ({ vehicleId, brandId: "b-looker" })))

  // Historial: correctiva del 15-10 con dos conductores y 3 h.
  await testDb.insert(schema.mantHistoricalRecords).values({
    sourceKey: "hist-correctiva-1", fingerprint: "fp-1", sourceFile: "consolidado.xlsx", sourceSheet: "MANTENCIONES", sourceRow: 10,
    submittedAt: "2026-10-16 10:00:00", worksiteText: "Faena Looker", worksiteId: WS, equipmentText: "KA-H / HIST-01", vehicleId: V.hist,
    equipmentMatch: "linked", orderText: "33873", kindText: "CORRECTIVA", readingText: "145.000", description: "Cambio de cruceta",
    entryDate: "2026-10-15", exitDate: "2026-10-16", hoursText: "3", fields: [
      { header: "CONDUCTOR QUE UTILIZO EL EQUIPO", value: "JUAN PEREZ, PEDRO SOTO" },
    ], importedBy: U, actionType: "correctiva", laborHours: 3, isTest: false,
  })

  // OT en taller el 20-10; queda fuera una OT sin ingreso.
  const ot = (id: string, entryAt: string | null) => ({
    id, folio: `OT-${id}`, vehicleId: V.ot, worksiteId: WS, equipmentSnapshot: SNAP("KA-OT", "OT-01"),
    repair: true, maintenance: false, requestDate: "2026-10-18", requestedByUserId: U, requesterName: "Solicitante",
    repairDescription: "Reparación de prueba", status: "en_ejecucion", assignedToUserId: U, assignedByUserId: U,
    assignedAt: entryAt ?? "2026-10-18T12:00:00Z", workshopKind: "interno", workshopEntryAt: entryAt,
    estimatedDeliveryDate: "2026-10-30", startedAt: entryAt, startedByUserId: U, actionType: "correctiva", laborHours: 4,
    workPerformed: "Reparación de frenos",
    ...(entryAt ? {} : { status: "asignada", workshopKind: null, estimatedDeliveryDate: null, startedAt: null, startedByUserId: null }),
  })
  await testDb.insert(schema.mantWorkOrders).values([
    ot("with-entry", "2026-10-20T12:00:00Z"),
    ot("without-entry", null),
  ])

  // Registro correctivo nativo desde el corte (05-12) con dos conductores.
  await testDb.insert(schema.mantRecords).values({
    id: "rec-correctiva", folio: "MR-C-1", kind: "C", vehicleId: V.rec, equipmentSnapshot: SNAP("KA-R", "REC-01"), worksiteId: WS,
    reading: 150_000, unit: "km", workDate: "2026-12-05", registeredBy: U, executorKind: "yo", executorUserId: U,
    executorName: "Mecánico Nativo", signedAt: "2026-12-05T15:00:00Z", receivedAt: "2026-12-05T15:00:00Z",
    status: "vigente", review: "pendiente",
  })
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId: "rec-correctiva", workTypes: ["Mecánico"], oils: [], description: "Cambio de filtro", noParts: true, hours: 2, inWorkshop: false,
  })
  await testDb.insert(schema.mantDrivers).values([
    { id: "d-ana", name: "ANA DIAZ", nameKey: "ana diaz" },
    { id: "d-luis", name: "LUIS ROJAS", nameKey: "luis rojas" },
  ])
  await testDb.insert(schema.mantRecordDrivers).values([
    { recordId: "rec-correctiva", driverId: "d-ana", driverName: "ANA DIAZ" },
    { recordId: "rec-correctiva", driverId: "d-luis", driverName: "LUIS ROJAS" },
  ])

  // Registro preventivo nativo desde el corte: 2 R, 1 NR y 1 NA → 66,7 %.
  await testDb.insert(schema.mantRecords).values({
    id: "rec-preventiva", folio: "MR-P-1", kind: "P", vehicleId: V.rec, equipmentSnapshot: SNAP("KA-R", "REC-01"), worksiteId: WS,
    reading: 151_000, unit: "km", workDate: "2026-12-10", registeredBy: U, executorKind: "yo", executorUserId: U,
    executorName: "Mecánico Nativo", signedAt: "2026-12-10T15:00:00Z", receivedAt: "2026-12-10T15:00:00Z",
    status: "vigente", review: "pendiente", scheduleVersion: 1, scheduleNameSnapshot: "Camiones", intervalValue: 40_000,
    suggestedIntervalValue: 40_000, notes: "Pauta de diciembre",
  })
  await testDb.insert(schema.mantRecordItems).values([
    { id: "i-r1", recordId: "rec-preventiva", itemKey: "r1", groupName: "Motor", itemName: "Cambio aceite", sortOrder: 0, value: "R" },
    { id: "i-r2", recordId: "rec-preventiva", itemKey: "r2", groupName: "Motor", itemName: "Filtro aire", sortOrder: 1, value: "R" },
    { id: "i-nr", recordId: "rec-preventiva", itemKey: "nr", groupName: "Frenos", itemName: "Revisión frenos", sortOrder: 2, value: "NR", reason: "Sin repuesto" },
    { id: "i-na", recordId: "rec-preventiva", itemKey: "na", groupName: "Frenos", itemName: "Revisión ABS", sortOrder: 3, value: "NA" },
  ])

  // Pauta histórica del 15-10 con mecánico, observación y detalle por ítem.
  await testDb.insert(schema.mantHistoricalScheduleChecks).values({
    sourceKey: "pauta-hist-1", fingerprint: "fp-p1", sourceFile: "consolidado.xlsx", sourceSheet: "PAUTAS_PREVENTIVAS", sourceRow: 3,
    submittedAt: "2026-10-16 10:00:00", performedOn: "2026-10-15", formKind: "CAMIONES", scheduleLabel: "40.000 KM",
    equipmentText: "KA-H / HIST-01", vehicleId: V.hist, equipmentMatch: "linked", worksiteText: "Faena Looker", worksiteId: WS,
    reading: 145_000, doneCount: 39, notDoneCount: 1, notApplicableCount: 9, compliance: 0.975,
    mechanic: "Javier Roa", observations: "Cambio de refrigerante pendiente", isTest: false, fields: [], importedBy: U,
  })
  await testDb.insert(schema.mantHistoricalScheduleItems).values([
    { sourceKey: "item-h-1", checkSourceKey: "pauta-hist-1", itemName: "Cambio aceite motor", result: "realizado", sortOrder: 0 },
    { sourceKey: "item-h-2", checkSourceKey: "pauta-hist-1", itemName: "Revisión frenos", result: "no_realizado", sortOrder: 1 },
    { sourceKey: "item-h-3", checkSourceKey: "pauta-hist-1", itemName: "Revisión ABS", result: "no_aplica", sortOrder: 2 },
  ])

  // Pauta publicada para el equipo nativo: la usa `loadFleet` para calcular A, B y la próxima.
  await testDb.insert(schema.mantSchedules).values({ id: "s-looker", name: "Camiones", nameKey: "camiones-looker", unit: "km", version: 1 })
  await testDb.insert(schema.mantScheduleVersions).values({
    scheduleId: "s-looker",
    version: 1,
    snapshot: {
      id: "s-looker", name: "Camiones", unit: "km", version: 1, intervals: [10_000, 40_000], groups: [], brandRules: [],
    },
    summary: "Pauta de prueba",
    createdBy: U,
  })
  await testDb.update(schema.mantEquipmentProfiles).set({ scheduleId: "s-looker" }).where(eq(schema.mantEquipmentProfiles.vehicleId, V.rec))

  // Una máquina por horas con su pauta (300 h y 900 h): sirve para ver que Camiones no la ofrece.
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-looker-h", slug: "looker-h", name: "Excavadora", category: "heavy", defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour" })
  await testDb.insert(schema.fuelVehicles).values({ id: V.hours, code: "TO-H", plate: "HRS-01", type: "Excavadora", equipmentTypeId: "fet-looker-h", worksiteId: WS, model: "D4", year: 2020, brand: "Caterpillar" })
  await testDb.insert(schema.mantEquipmentProfiles).values({ vehicleId: V.hours, brandId: "b-looker" })
  await testDb.insert(schema.mantSchedules).values({ id: "s-looker-h", name: "Maquinaria", nameKey: "maquinaria-looker", unit: "h", version: 1 })
  await testDb.insert(schema.mantScheduleVersions).values({
    scheduleId: "s-looker-h",
    version: 1,
    snapshot: { id: "s-looker-h", name: "Maquinaria", unit: "h", version: 1, intervals: [300, 900], groups: [], brandRules: [] },
    summary: "Pauta de máquinas de prueba",
    createdBy: U,
  })
  await testDb.update(schema.mantEquipmentProfiles).set({ scheduleId: "s-looker-h" }).where(eq(schema.mantEquipmentProfiles.vehicleId, V.hours))
})

describe("Contexto de la pestaña · opciones acotadas por unidad", () => {
  const ofTab = (raw: Record<string, string>) => loadLookerContext(GLOBAL, { desde: "2026-10-01", hasta: "2026-10-31", ...raw }, "2026-11-23")

  it("Camiones ofrece sólo lo de km y Máquinas sólo lo de horas", async () => {
    const trucks = await ofTab({ pestana: "camiones" })
    expect(trucks.options.equipment.map((item) => item.id).sort()).toEqual([V.hist, V.ot, V.rec].sort())
    expect(trucks.options.frequencies.map((item) => item.unit)).toEqual(["km", "km"])
    const machines = await ofTab({ pestana: "maquinas" })
    expect(machines.options.equipment.map((item) => item.id)).toEqual([V.hours])
    expect(machines.options.frequencies.map((item) => item.value)).toEqual([300, 900])
  })

  it("Planificación y Hoy conservan las dos unidades", async () => {
    expect((await ofTab({ pestana: "planificacion" })).options.equipment).toHaveLength(4)
    expect((await ofTab({})).options.frequencies).toHaveLength(4)
  })

  it("un equipo o una frecuencia de la otra unidad en la URL se ignora, manual o cruzado", async () => {
    const context = await ofTab({ pestana: "camiones", equipo: `${V.rec},${V.hours}`, frecuencia: "40000,300", x_equipo: V.hours })
    expect(context.filters.equipmentIds).toEqual([V.rec])
    expect(context.filters.frequencies).toEqual([40_000])
    expect(context.cross.equipment).toBeUndefined()
    // En Planificación el mismo equipo sí se resuelve: la pestaña muestra las dos unidades.
    expect((await ofTab({ pestana: "planificacion", x_equipo: V.hours })).cross.equipment?.id).toBe(V.hours)
  })
})

describe("Correctivo · unión y paginación", () => {
  it("une histórico y OT con ingreso, y excluye la OT sin ingreso", async () => {
    const page = await loadCorrectivePage(GLOBAL, filters("2026-10-01", "2026-10-31"), {})
    expect(page.total).toBe(2)
    expect(page.rows.map((row) => row.source)).toEqual(["ot", "historial"])
    expect(page.rows[0]!.reference).toBe("OT-with-entry")
    expect(page.rows[0]!.workPerformed).toBe("Reparación de frenos")
    expect(page.rows[1]!.reference).toBe("33873")
  })

  it("filtra por unidad: una máquina por horas no entra en Camiones", async () => {
    const page = await loadCorrectivePage(GLOBAL, filters("2026-10-01", "2026-10-31", "maquinas"), {})
    expect(page.total).toBe(0)
  })

  it("el conductor del histórico reparte las horas y filtra la tabla por sus trabajos", async () => {
    const summary = await loadCorrectiveSummary(GLOBAL, filters("2026-10-01", "2026-10-31"), {})
    const juan = summary.drivers.find((driver) => driver.label === "JUAN PEREZ")
    expect(juan?.hours).toBe(1.5)
    expect(summary.drivers.find((driver) => driver.label === "PEDRO SOTO")?.hours).toBe(1.5)
    const filtered = await loadCorrectivePage(GLOBAL, filters("2026-10-01", "2026-10-31"), {}, { conductorWorkIds: juan!.workIds })
    expect(filtered.total).toBe(1)
    expect(filtered.rows[0]!.source).toBe("historial")
  })

  it("el registro nativo desde el corte también aparece y suma a sus dos conductores", async () => {
    const summary = await loadCorrectiveSummary(GLOBAL, filters("2026-12-01", "2026-12-31"), {})
    expect(summary.drivers.find((driver) => driver.label === "ANA DIAZ")?.hours).toBe(1)
    expect(summary.drivers.find((driver) => driver.label === "LUIS ROJAS")?.hours).toBe(1)
    const page = await loadCorrectivePage(GLOBAL, filters("2026-12-01", "2026-12-31"), {})
    expect(page.rows[0]!.source).toBe("registro")
  })
})

describe("Planificación · opciones y A/B", () => {
  it("la pauta publicada da frecuencia, A/B, delta y faltantes con la regla actual", async () => {
    const options = await loadLookerOptions(GLOBAL)
    const rec = options.equipment.find((equipment) => equipment.id === V.rec)
    expect(rec).toMatchObject({ unit: "km", frequency: 40_000, intervals: [10_000, 40_000] })
    expect(options.frequencies.map((frequency) => `${frequency.value} ${frequency.unit}`)).toEqual(["10000 km", "40000 km", "300 h", "900 h"])

    const planning = await loadPlanningData(GLOBAL, filters("2026-12-01", "2026-12-31"), {})
    const row = planning.km.find((item) => item.vehicleId === V.rec)!
    expect(row.programmed).toBe(150_000)
    expect(row.real).toBe(151_000)
    expect(row.delta).toBe(-1_000)
    expect(row.next).toBe(160_000)
    expect(row.remaining).toBe(9_000)
    expect(row.frequency).toBe(40_000)
  })
})

describe("Preventivo · cumplimiento y matriz", () => {
  it("histórico antes del corte: usa R / (R + NR) y no mezcla el registro nativo", async () => {
    const checks = await loadComplianceChecks(GLOBAL, filters("2026-10-01", "2026-10-31"), {})
    expect(checks).toHaveLength(1)
    expect(checks[0]!.mechanic).toBe("Javier Roa")
    expect(checks[0]!.percent).toBe(97.5)
    const compliance = await loadPreventiveCompliance(GLOBAL, filters("2026-10-01", "2026-10-31"), {})
    expect(compliance.average).toBe(97.5)
    expect(compliance.byMonth.find((bucket) => bucket.key === "2026-10")?.percent).toBe(97.5)
    expect(compliance.byPlate[0]).toMatchObject({ code: "KA-H", percent: 97.5, levels: ["40.000 KM"] })
  })

  it("nativo desde el corte: 2 R, 1 NR y 1 NA → 66,7 %", async () => {
    const checks = await loadComplianceChecks(GLOBAL, filters("2026-12-01", "2026-12-31"), {})
    expect(checks).toHaveLength(1)
    expect(checks[0]!.source).toBe("registro")
    expect(checks[0]!.done).toBe(2)
    expect(checks[0]!.notDone).toBe(1)
    expect(checks[0]!.notApplicable).toBe(1)
    expect(checks[0]!.percent).toBe(66.7)
  })

  it("la matriz histórica trae una columna con sus ítems y observaciones", async () => {
    const matrix = await loadChecklistMatrix(GLOBAL, filters("2026-10-01", "2026-10-31"), {})
    expect(matrix.checks).toHaveLength(1)
    expect(matrix.checks[0]!.observations).toBe("Cambio de refrigerante pendiente")
    expect(matrix.items.map((item) => item.name)).toEqual(["Cambio aceite motor", "Revisión frenos", "Revisión ABS"])
    expect(matrix.checks[0]!.items["Revisión frenos"]).toBe("no_realizado")
    expect(matrix.withoutDetail).toBe(0)
  })

  it("la matriz nativa trae la columna del registro y sus estados", async () => {
    const matrix = await loadChecklistMatrix(GLOBAL, filters("2026-12-01", "2026-12-31"), {})
    expect(matrix.checks).toHaveLength(1)
    expect(matrix.checks[0]!.source).toBe("registro")
    expect(matrix.checks[0]!.items["Cambio aceite"]).toBe("realizado")
    expect(matrix.checks[0]!.items["Revisión frenos"]).toBe("no_realizado")
    expect(matrix.checks[0]!.items["Revisión ABS"]).toBe("no_aplica")
  })
})
