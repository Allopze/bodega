import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import type { LookerFilters } from "./types"

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

const { loadCorrectivePage } = await import("@/lib/services/mantencion/looker/corrective")
const { loadCorrectiveTabData } = await import("@/lib/services/mantencion/looker/corrective-tab-data")
const { loadChecklistMatrix, loadComplianceChecks, loadPreventiveCompliance } = await import("@/lib/services/mantencion/looker/preventive")
const { loadLookerContext, loadLookerOptions } = await import("@/lib/services/mantencion/looker/resolve")
const { loadPlanningData } = await import("@/lib/services/mantencion/looker/planning")

const WS = "ws-looker"
const U = "u-looker"
const V = { hist: "v-looker-hist", ot: "v-looker-ot", rec: "v-looker-rec", hours: "v-looker-hours" } as const
const GLOBAL = { userId: U, email: null, permissions: ["mant:records:view_all", "mant:ot:view_all"], worksiteIds: [], isGlobal: true }
const SNAP = (code: string, plate: string) => ({ code, plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Faena Looker", unit: "km" as const })

/**
 * Filtros de una pestaña. `camiones`/`maquinas` (los nombres de antes) se leen como Correctivo en km u horas, igual
 * que la URL; el tercer argumento también acepta una pestaña nueva, que va en km salvo `unit`.
 */
const filters = (
  from: string,
  to: string,
  tab: "camiones" | "maquinas" | "planificacion" | "correctivo" | "preventivo" = "camiones",
  unit?: "km" | "h",
): LookerFilters => ({
  tab: tab === "camiones" || tab === "maquinas" ? "correctivo" : tab,
  unit: unit ?? (tab === "maquinas" ? "h" : "km"),
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
  planningState: null,
  dateField: "proxima",
  dateFrom: null,
  dateTo: null,
  invalidDateRange: false,
  sheetVehicleId: null,
  sheetCheckId: null,
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
  // El registro nativo trae sus dos fotos de evidencia (filtros y sticker): fotos completas.
  await testDb.insert(schema.mantRecordPhotos).values(["filtros", "sticker"].map((kind, index) => ({
    id: `ph-rec-prev-${kind}`, recordId: "rec-preventiva", kind, storageKey: `storage/mantencion/ph-rec-prev-${kind}.jpg`, mimeType: "image/jpeg",
    sha256: "0".repeat(64), bytes: 4, width: 100, height: 100, stampedAt: "2026-12-10T15:00:00Z", uploadedBy: U, sortOrder: index,
  })))

  // Pauta histórica del 15-10 con mecánico, observación y detalle por ítem.
  await testDb.insert(schema.mantHistoricalScheduleChecks).values({
    sourceKey: "pauta-hist-1", fingerprint: "fp-p1", sourceFile: "consolidado.xlsx", sourceSheet: "PAUTAS_PREVENTIVAS", sourceRow: 3,
    submittedAt: "2026-10-16 10:00:00", performedOn: "2026-10-15", formKind: "CAMIONES", scheduleLabel: "40.000 KM",
    equipmentText: "KA-H / HIST-01", vehicleId: V.hist, equipmentMatch: "linked", worksiteText: "Faena Looker", worksiteId: WS,
    reading: 145_000, doneCount: 39, notDoneCount: 1, notApplicableCount: 9, compliance: 0.975,
    mechanic: "Javier Roa", observations: "Cambio de refrigerante pendiente", isTest: false, fields: [], importedBy: U,
    // Sólo el enlace de filtros: sin sticker, la pauta cuenta como de fotos incompletas.
    filtersPhotoUrl: "https://drive.google.com/open?id=filtros-1",
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

  it("km (por defecto) ofrece sólo lo de km y `unidad=h` sólo lo de horas, en las tres pestañas", async () => {
    for (const pestana of ["planificacion", "correctivo", "preventivo"]) {
      const trucks = await ofTab({ pestana })
      expect(trucks.options.equipment.map((item) => item.id).sort(), pestana).toEqual([V.hist, V.ot, V.rec].sort())
      expect(trucks.options.frequencies.map((item) => item.unit), pestana).toEqual(["km", "km"])
      const machines = await ofTab({ pestana, unidad: "h" })
      expect(machines.options.equipment.map((item) => item.id), pestana).toEqual([V.hours])
      expect(machines.options.frequencies.map((item) => item.value), pestana).toEqual([300, 900])
    }
  })

  it("un enlace viejo `pestana=maquinas` se acota a horas, como Correctivo por horas", async () => {
    const context = await ofTab({ pestana: "maquinas" })
    expect(context.filters).toMatchObject({ tab: "correctivo", unit: "h" })
    expect(context.options.equipment.map((item) => item.id)).toEqual([V.hours])
  })

  it("Hoy conserva las dos unidades", async () => {
    expect((await ofTab({})).options.frequencies).toHaveLength(4)
    expect((await ofTab({})).options.equipment).toHaveLength(4)
  })

  it("un equipo o una frecuencia de la otra unidad en la URL se ignora, manual o cruzado, también en Planificación", async () => {
    for (const pestana of ["correctivo", "planificacion"]) {
      const context = await ofTab({ pestana, equipo: `${V.rec},${V.hours}`, frecuencia: "40000,300", x_equipo: V.hours })
      expect(context.filters.equipmentIds, pestana).toEqual([V.rec])
      expect(context.filters.frequencies, pestana).toEqual([40_000])
      expect(context.cross.equipment, pestana).toBeUndefined()
    }
    // Con la unidad del equipo, sí se resuelve.
    expect((await ofTab({ pestana: "planificacion", unidad: "h", x_equipo: V.hours })).cross.equipment?.id).toBe(V.hours)
  })
})

/** La pestaña Correctivo como la arma la página: contexto desde la URL y todos sus bloques con los filtros que cada uno aplica. */
async function correctiveTab(raw: Record<string, string>, seriesLimit?: number) {
  const context = await loadLookerContext(GLOBAL, { pestana: "correctivo", ...raw }, raw.hasta ?? "2026-12-31")
  const data = await loadCorrectiveTabData(
    GLOBAL,
    context,
    () => loadCorrectivePage(GLOBAL, context.filters, context.cross),
    seriesLimit === undefined ? {} : { seriesLimit },
  )
  return { context, ...data }
}

describe("Correctivo · unión, tira de cifras y gráficos", () => {
  const OCT = { desde: "2026-10-01", hasta: "2026-10-31" }
  const OCT_DIC = { desde: "2026-10-01", hasta: "2026-12-31" }
  const DIC = { desde: "2026-12-01", hasta: "2026-12-31" }

  it("une histórico y OT con ingreso, y excluye la OT sin ingreso; el histórico trae sus conductores", async () => {
    const { rows } = await correctiveTab(OCT)
    expect(rows.total).toBe(2)
    expect(rows.rows.map((row) => row.source)).toEqual(["ot", "historial"])
    expect(rows.rows[0]!.reference).toBe("OT-with-entry")
    expect(rows.rows[0]!.workPerformed).toBe("Reparación de frenos")
    expect(rows.rows[1]!.reference).toBe("33873")
    expect(rows.rows[1]!.drivers).toEqual(["JUAN PEREZ", "PEDRO SOTO"])
  })

  it("filtra por unidad: una máquina por horas no entra en el correctivo de km y la unidad h no ve los camiones", async () => {
    const hours = await correctiveTab({ ...OCT, unidad: "h" })
    expect(hours.rows.total).toBe(0)
    expect(hours.stats).toEqual({ total: 0, hours: 0, equipment: 0, photoEligible: 0, withoutPhoto: 0 })
    expect(hours.context.options.equipment.map((item) => item.id)).toEqual([V.hours])
  })

  it("la tira suma trabajos, horas y equipos distintos; sin foto cuenta sólo OT y registros (el histórico no trae fotos)", async () => {
    const { stats } = await correctiveTab(OCT)
    expect(stats).toEqual({ total: 2, hours: 7, equipment: 2, photoEligible: 1, withoutPhoto: 1 })
  })

  it("una foto correctiva del registro lo saca de «sin foto»", async () => {
    await testDb.insert(schema.mantRecordPhotos).values({
      id: "ph-rec-corr", recordId: "rec-correctiva", kind: "correctiva", storageKey: "storage/mantencion/ph-rec-corr.jpg", mimeType: "image/jpeg",
      sha256: "1".repeat(64), bytes: 4, width: 100, height: 100, stampedAt: "2026-12-05T15:00:00Z", uploadedBy: U, sortOrder: 0,
    })
    try {
      expect((await correctiveTab(DIC)).stats).toMatchObject({ total: 1, photoEligible: 1, withoutPhoto: 0 })
    } finally {
      await testDb.delete(schema.mantRecordPhotos).where(eq(schema.mantRecordPhotos.id, "ph-rec-corr"))
    }
    expect((await correctiveTab(DIC)).stats).toMatchObject({ total: 1, photoEligible: 1, withoutPhoto: 1 })
  })

  it("el conductor reparte las horas del trabajo entre sus conductores", async () => {
    const { drivers } = await correctiveTab(OCT)
    expect(drivers.find((driver) => driver.label === "JUAN PEREZ")).toMatchObject({ hours: 1.5, records: 1 })
    expect(drivers.find((driver) => driver.label === "PEDRO SOTO")).toMatchObject({ hours: 1.5, records: 1 })
  })

  it("el registro nativo desde el corte también aparece y suma a sus dos conductores", async () => {
    const { drivers, rows } = await correctiveTab(DIC)
    expect(drivers.find((driver) => driver.label === "ANA DIAZ")?.hours).toBe(1)
    expect(drivers.find((driver) => driver.label === "LUIS ROJAS")?.hours).toBe(1)
    expect(rows.rows[0]!.source).toBe("registro")
    expect(rows.rows[0]!.drivers).toEqual(["ANA DIAZ", "LUIS ROJAS"])
  })

  it("el conductor elegido acota la tabla, la tira, el equipo y el mes; el gráfico de conductores sigue completo", async () => {
    const tab = await correctiveTab({ ...OCT_DIC, x_conductor: "JUAN PEREZ" })
    expect(tab.rows.total).toBe(1)
    expect(tab.rows.rows[0]!.source).toBe("historial")
    expect(tab.stats).toMatchObject({ total: 1, hours: 3, equipment: 1 })
    expect(tab.series.map((row) => row.vehicleId)).toEqual([V.hist])
    expect(tab.monthly.map((month) => month.count)).toEqual([1, 0, 0])
    // El gráfico de conductores no se filtra por el conductor que emite: todos siguen a la vista.
    expect(tab.drivers.map((driver) => driver.label).sort()).toEqual(["ANA DIAZ", "JUAN PEREZ", "LUIS ROJAS", "PEDRO SOTO"])
  })

  it("un conductor sin trabajos deja todo vacío en vez de quitar el filtro", async () => {
    const tab = await correctiveTab({ ...OCT, x_conductor: "NADIE EN ESTA FAENA" })
    expect(tab.rows.total).toBe(0)
    expect(tab.stats.total).toBe(0)
    expect(tab.series).toEqual([])
  })

  it("el mes elegido acota la tabla, la tira y los demás gráficos, pero no el gráfico de meses", async () => {
    const all = await correctiveTab(OCT_DIC)
    expect(all.rows.total).toBe(3)

    const tab = await correctiveTab({ ...OCT_DIC, x_mes: "2026-12" })
    expect(tab.rows.total).toBe(1)
    expect(tab.rows.rows[0]!.source).toBe("registro")
    expect(tab.stats.total).toBe(1)
    expect(tab.series.map((row) => row.vehicleId)).toEqual([V.rec])
    expect(tab.drivers.map((driver) => driver.label).sort()).toEqual(["ANA DIAZ", "LUIS ROJAS"])
    // Los meses siguen todos, con cero donde no hubo trabajo.
    expect(tab.monthly.map((month) => [month.key, month.count])).toEqual([["2026-10", 2], ["2026-11", 0], ["2026-12", 1]])
    expect(tab.monthly.map((month) => month.label)).toEqual(["oct 2026", "nov 2026", "dic 2026"])
  })

  it("el equipo elegido acota la tabla, la tira y los meses; el gráfico de equipos sigue completo y rotula con la patente", async () => {
    const tab = await correctiveTab({ ...OCT, x_equipo: V.hist })
    expect(tab.rows.total).toBe(1)
    expect(tab.stats).toMatchObject({ total: 1, equipment: 1 })
    expect(tab.monthly.map((month) => month.count)).toEqual([1])
    // Ordenado de más a menos horas: la OT (4 h) antes que el formulario (3 h).
    expect(tab.series.map((row) => [row.label, row.hours, row.records])).toEqual([["OT-01", 4, 1], ["HIST-01", 3, 1]])
    expect(tab.series[1]).toMatchObject({ code: "KA-H", plate: "HIST-01" })
  })

  it("el gráfico de equipos dibuja los N con más horas; la exportación pide todos", async () => {
    expect((await correctiveTab(OCT, 1)).series.map((row) => row.label)).toEqual(["OT-01"])
    expect((await correctiveTab(OCT, Number.POSITIVE_INFINITY)).series).toHaveLength(2)
  })

  it("la OT elegida acota la tira y los gráficos, pero no la tabla (no se filtra a sí misma)", async () => {
    const tab = await correctiveTab({ ...OCT, x_ot: "ot:with-entry" })
    expect(tab.rows.total).toBe(2)
    expect(tab.stats.total).toBe(1)
  })

  it("un registro con OT cuenta por la OT; si la OT se anula, cuenta el registro (REG4-1)", async () => {
    // Semana propia (14 al 20-12) y limpieza al final: las demás pruebas leen diciembre completo.
    await testDb.insert(schema.mantWorkOrders).values({
      id: "ot-reg4-1", folio: "OT-REG4-1", vehicleId: V.rec, worksiteId: WS, equipmentSnapshot: SNAP("KA-R", "REC-01"),
      repair: true, maintenance: false, requestDate: "2026-12-14", requestedByUserId: U, requesterName: "Solicitante",
      repairDescription: "Reparación de frenos", status: "en_ejecucion", assignedToUserId: U, assignedByUserId: U,
      assignedAt: "2026-12-15T12:00:00Z", workshopKind: "interno", workshopEntryAt: "2026-12-15T12:00:00Z",
      estimatedDeliveryDate: "2026-12-20", startedAt: "2026-12-15T12:00:00Z", startedByUserId: U, actionType: "correctiva",
    })
    await testDb.insert(schema.mantRecords).values({
      id: "rec-con-ot", folio: "MR-C-2", kind: "C", vehicleId: V.rec, equipmentSnapshot: SNAP("KA-R", "REC-01"), worksiteId: WS,
      reading: 152_000, unit: "km", workDate: "2026-12-16", registeredBy: U, executorKind: "yo", executorUserId: U,
      executorName: "Mecánico Nativo", signedAt: "2026-12-16T15:00:00Z", receivedAt: "2026-12-16T15:00:00Z",
      status: "vigente", review: "pendiente", workOrderId: "ot-reg4-1",
    })
    await testDb.insert(schema.mantRecordCorrectives).values({
      recordId: "rec-con-ot", workTypes: ["Mecánico"], oils: [], description: "Cambio de pastillas", noParts: true, hours: 1, inWorkshop: false,
    })
    const week = async () => (await correctiveTab({ desde: "2026-12-14", hasta: "2026-12-20" })).rows.rows.map((row) => `${row.source}:${row.reference}`)
    try {
      // Mientras la OT cuenta, el trabajo es la OT y el registro no se repite.
      expect(await week()).toEqual(["ot:OT-REG4-1"])
      await testDb.update(schema.mantWorkOrders).set({
        status: "anulada", voidedAt: "2026-12-17T12:00:00Z", voidedByUserId: U, voidReason: "Se abrió por error",
      }).where(eq(schema.mantWorkOrders.id, "ot-reg4-1"))
      // Anulada la OT, el registro firmado es el único rastro del trabajo: no puede desaparecer del Panel.
      expect(await week()).toEqual(["registro:MR-C-2"])
    } finally {
      await testDb.delete(schema.mantRecordCorrectives).where(eq(schema.mantRecordCorrectives.recordId, "rec-con-ot"))
      await testDb.delete(schema.mantRecords).where(eq(schema.mantRecords.id, "rec-con-ot"))
      await testDb.delete(schema.mantWorkOrders).where(eq(schema.mantWorkOrders.id, "ot-reg4-1"))
    }
  })
})

describe("Planificación · opciones y A/B", () => {
  it("la pauta publicada da frecuencia, A/B, delta y faltantes con la regla actual", async () => {
    const options = await loadLookerOptions(GLOBAL)
    const rec = options.equipment.find((equipment) => equipment.id === V.rec)
    expect(rec).toMatchObject({ unit: "km", frequency: 40_000, intervals: [10_000, 40_000] })
    expect(options.frequencies.map((frequency) => `${frequency.value} ${frequency.unit}`)).toEqual(["10000 km", "40000 km", "300 h", "900 h"])

    const planning = await loadPlanningData(GLOBAL, filters("2026-12-01", "2026-12-31"), {})
    const row = planning.rows.find((item) => item.vehicleId === V.rec)!
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
    expect(compliance.byPlate[0]).toMatchObject({
      code: "KA-H", percent: 97.5, levels: ["40.000 KM"], notDone: 1, lastDate: "2026-10-15", lastMechanic: "Javier Roa", withoutPhotos: 1,
    })
    expect(compliance).toMatchObject({ notDone: 1, withoutPhotos: 1 })
    expect(checks[0]!.photosComplete).toBe(false)
  })

  it("nativo desde el corte: 2 R, 1 NR y 1 NA → 66,7 %", async () => {
    const checks = await loadComplianceChecks(GLOBAL, filters("2026-12-01", "2026-12-31"), {})
    expect(checks).toHaveLength(1)
    expect(checks[0]!.source).toBe("registro")
    expect(checks[0]!.done).toBe(2)
    expect(checks[0]!.notDone).toBe(1)
    expect(checks[0]!.notApplicable).toBe(1)
    expect(checks[0]!.percent).toBe(66.7)
    expect(checks[0]!.photosComplete).toBe(true)
  })

  it("la matriz histórica trae una columna con sus ítems y observaciones", async () => {
    const matrix = await loadChecklistMatrix(GLOBAL, filters("2026-10-01", "2026-10-31"), {})
    expect(matrix.checks).toHaveLength(1)
    expect(matrix.checks[0]!.observations).toBe("Cambio de refrigerante pendiente")
    expect(matrix.checks[0]!.vehicleId).toBe(V.hist)
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

/**
 * Unidad efectiva: la fija el perfil de Mantención (`mant_equipment_profiles.unit`) y, si es nula, vale
 * la del tipo. Dos camiones del mismo tipo (odómetro) miden distinto: uno en horas (fijado en su perfil)
 * y otro en km (sin fijar).
 *
 * Va al final del archivo a propósito: siembra equipos y registros que cambiarían las cifras de las
 * pruebas de arriba, y Vitest corre los `describe` en orden.
 */
describe("Unidad efectiva · el perfil de Mantención antes que el tipo", () => {
  const T = { hours: "v-looker-camion-h", km: "v-looker-camion-km" } as const
  const OWN: readonly string[] = [T.hours, T.km]
  const DESDE = "2026-12-01"
  const HASTA = "2026-12-31"
  const snap = (code: string, plate: string, unit: "km" | "h") => ({
    code, plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Faena Looker", unit,
  })
  const recordBase = {
    worksiteId: WS, registeredBy: U, executorKind: "yo", executorUserId: U, executorName: "Mecánico Unidad",
    signedAt: "2026-12-10T15:00:00Z", receivedAt: "2026-12-10T15:00:00Z", status: "vigente", review: "pendiente",
  }

  beforeAll(async () => {
    await testDb.insert(schema.fuelVehicles).values([
      { id: T.hours, code: "KA-HOR", plate: "HOR-01", type: "Camión", equipmentTypeId: "fet-looker", worksiteId: WS, model: "R450", year: 2021, brand: "Scania" },
      { id: T.km, code: "KA-KM", plate: "KMS-01", type: "Camión", equipmentTypeId: "fet-looker", worksiteId: WS, model: "R450", year: 2021, brand: "Scania" },
    ])
    await testDb.insert(schema.mantEquipmentProfiles).values([
      { vehicleId: T.hours, brandId: "b-looker", unit: "h" },
      { vehicleId: T.km, brandId: "b-looker" },
    ])

    await testDb.insert(schema.mantRecords).values([
      // Correctiva firmada en km antes del cambio: el trabajo cuenta; su lectura no sale en horas.
      { ...recordBase, id: "rec-h-c-km", folio: "MU-C-1", kind: "C", vehicleId: T.hours, equipmentSnapshot: snap("KA-HOR", "HOR-01", "km"), reading: 100_000, unit: "km", workDate: "2026-12-03" },
      // Preventiva en km de la pauta anterior, más reciente que la de horas: no fija la frecuencia ni rotula el check.
      { ...recordBase, id: "rec-h-p-km", folio: "MU-P-1", kind: "P", vehicleId: T.hours, equipmentSnapshot: snap("KA-HOR", "HOR-01", "km"), reading: 99_000, unit: "km", workDate: "2026-12-20", scheduleVersion: 1, scheduleNameSnapshot: "Camiones", intervalValue: 40_000, suggestedIntervalValue: 40_000, notes: "Pauta vieja en km" },
      // Preventiva en horas: la última de la unidad activa.
      { ...recordBase, id: "rec-h-p-h", folio: "MU-P-2", kind: "P", vehicleId: T.hours, equipmentSnapshot: snap("KA-HOR", "HOR-01", "h"), reading: 2_100, unit: "h", workDate: "2026-12-12", scheduleVersion: 1, scheduleNameSnapshot: "Maquinaria", intervalValue: 300, suggestedIntervalValue: 300, notes: "Pauta de horas" },
      // Camión sin unidad fijada: mide en km como su tipo.
      { ...recordBase, id: "rec-k-c", folio: "MU-C-2", kind: "C", vehicleId: T.km, equipmentSnapshot: snap("KA-KM", "KMS-01", "km"), reading: 90_000, unit: "km", workDate: "2026-12-08" },
      { ...recordBase, id: "rec-k-p", folio: "MU-P-3", kind: "P", vehicleId: T.km, equipmentSnapshot: snap("KA-KM", "KMS-01", "km"), reading: 91_000, unit: "km", workDate: "2026-12-15", scheduleVersion: 1, scheduleNameSnapshot: "Camiones", intervalValue: 10_000, suggestedIntervalValue: 10_000, notes: "Pauta de km" },
    ])
    await testDb.insert(schema.mantRecordCorrectives).values([
      { recordId: "rec-h-c-km", workTypes: ["Mecánico"], oils: [], description: "Cambio de correa", noParts: true, hours: 2, inWorkshop: false },
      { recordId: "rec-k-c", workTypes: ["Mecánico"], oils: [], description: "Cambio de filtro", noParts: true, hours: 1, inWorkshop: false },
    ])

    // OT con ingreso en diciembre: el camión de horas lleva el horómetro (2.300) además de un odómetro viejo.
    const orderBase = {
      worksiteId: WS, requestDate: "2026-12-07", requestedByUserId: U, requesterName: "Solicitante Unidad", repair: true, maintenance: false,
      repairDescription: "Reparación de prueba", status: "en_ejecucion", assignedToUserId: U, assignedByUserId: U, assignedAt: "2026-12-07T12:00:00Z",
      workshopKind: "interno", estimatedDeliveryDate: "2026-12-15", startedByUserId: U, actionType: "correctiva", laborHours: 3, workPerformed: "Cambio de embrague",
    }
    await testDb.insert(schema.mantWorkOrders).values([
      { ...orderBase, id: "ot-h", folio: "OT-UNIDAD-H", vehicleId: T.hours, equipmentSnapshot: snap("KA-HOR", "HOR-01", "h"), workshopEntryAt: "2026-12-09T12:00:00Z", startedAt: "2026-12-09T12:00:00Z", entryOdometer: 150_000, entryHourmeter: 2_300 },
      { ...orderBase, id: "ot-k", folio: "OT-UNIDAD-K", vehicleId: T.km, equipmentSnapshot: snap("KA-KM", "KMS-01", "km"), workshopEntryAt: "2026-12-10T12:00:00Z", startedAt: "2026-12-10T12:00:00Z", entryOdometer: 88_000, entryHourmeter: null },
    ])
  })

  it("la unidad efectiva sale del perfil fijado y, sin él, del tipo; la frecuencia es la de su unidad", async () => {
    const options = await loadLookerOptions(GLOBAL)
    expect(options.equipment.find((item) => item.id === T.hours)).toMatchObject({ unit: "h", frequency: 300 })
    expect(options.equipment.find((item) => item.id === T.km)).toMatchObject({ unit: "km", frequency: 10_000 })
  })

  it("Camiones y Máquinas separan a los dos, y una URL con el otro no lo cruza", async () => {
    const both = `${T.km},${T.hours}`
    const trucks = await loadLookerContext(GLOBAL, { desde: DESDE, hasta: HASTA, pestana: "camiones", equipo: both }, HASTA)
    expect(trucks.options.equipment.map((item) => item.id)).toContain(T.km)
    expect(trucks.options.equipment.map((item) => item.id)).not.toContain(T.hours)
    expect(trucks.filters.equipmentIds).toEqual([T.km])

    const machines = await loadLookerContext(GLOBAL, { desde: DESDE, hasta: HASTA, pestana: "maquinas", equipo: both }, HASTA)
    expect(machines.options.equipment.map((item) => item.id)).toContain(T.hours)
    expect(machines.options.equipment.map((item) => item.id)).not.toContain(T.km)
    expect(machines.filters.equipmentIds).toEqual([T.hours])
  })

  it("el correctivo toma el odómetro en km y el horómetro de la OT en horas", async () => {
    const trucks = await correctiveTab({ desde: DESDE, hasta: HASTA })
    expect(trucks.rows.rows.filter((row) => OWN.includes(row.vehicleId!)).map((row) => [row.id, row.unit, row.reading])).toEqual([
      ["ot:ot-k", "km", 88_000],
      ["r:rec-k-c", "km", 90_000],
    ])

    // La correctiva en km de un camión que ya mide en horas sigue contando, sin lectura en la unidad activa.
    const machines = await correctiveTab({ desde: DESDE, hasta: HASTA, unidad: "h" })
    expect(machines.rows.rows.filter((row) => OWN.includes(row.vehicleId!)).map((row) => [row.id, row.unit, row.reading])).toEqual([
      ["ot:ot-h", "h", 2_300],
      ["r:rec-h-c-km", "h", null],
    ])
  })

  it("el cumplimiento cuenta sólo las pautas de la unidad efectiva del equipo", async () => {
    const machines = await loadComplianceChecks(GLOBAL, filters(DESDE, HASTA, "maquinas"), {})
    expect(machines.filter((check) => OWN.includes(check.vehicleId!)).map((check) => [check.id, check.level])).toEqual([["r:rec-h-p-h", "300 h"]])

    const trucks = await loadComplianceChecks(GLOBAL, filters(DESDE, HASTA, "camiones"), {})
    expect(trucks.filter((check) => check.vehicleId === T.hours)).toEqual([])
    expect(trucks.filter((check) => check.vehicleId === T.km).map((check) => [check.id, check.level])).toEqual([["r:rec-k-p", "10.000 km"]])
  })
})
