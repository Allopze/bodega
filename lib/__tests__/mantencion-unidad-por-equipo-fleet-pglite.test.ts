import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { daysAgo, IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Unidad por equipo (Mantención, decisión del usuario 2026-11-25) contra Postgres real. Un camión del
 * tipo «Camión» (odómetro) puede medir en horas si su perfil lo fija (`mant_equipment_profiles.unit`),
 * y otro camión del MISMO tipo sin unidad fijada sigue en km. La flota, la validación de un registro
 * nuevo, el historial del mecánico, los candidatos de una pauta, la lista de OT y el conteo de pautas
 * leen la unidad EFECTIVA del equipo; los registros de otra unidad quedan como historia y no cuentan.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { loadFleet } = await import("@/lib/services/mantencion/fleet")
const { loadVehicleHistory } = await import("@/lib/services/mantencion/records-create-context")
const { loadAppHistory } = await import("@/lib/services/mantencion/app-history")
const { listAssignCandidates } = await import("@/lib/services/mantencion/schedule-assign")
const { listWorkOrderEquipmentOptions } = await import("@/lib/services/mantencion/work-orders/query")
const { listIncorporationCandidates } = await import("@/lib/services/mantencion/fleet-incorporation")
const { listSchedules } = await import("@/lib/services/mantencion/schedules")

/** Camión del tipo odómetro que el perfil fija en HORAS (Cholguán). */
const HOURS_TRUCK = "v-h-prod"
/** Camión de Biodiversa y tractocamión sin perfil: sólo para la regla de alta de la incorporación. */
const INC_CHOLGUAN = "v-inc-cho"
const INC_BIODIVERSA = "v-inc-bio"

async function viewerOf(userId: string) {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}

interface PreventiveSeed {
  id: string
  folio: string
  vehicleId: string
  code: string
  plate: string
  worksiteId: string
  reading: number
  unit: "km" | "h"
  workDate: string
  scheduleId: string
  scheduleName: string
  intervalValue: number
}

async function insertPreventive(seed: PreventiveSeed) {
  const now = new Date().toISOString()
  await testDb.insert(schema.mantRecords).values({
    id: seed.id, folio: seed.folio, kind: "P", vehicleId: seed.vehicleId,
    equipmentSnapshot: { code: seed.code, plate: seed.plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Cholguán", unit: seed.unit },
    worksiteId: seed.worksiteId, reading: seed.reading, unit: seed.unit, workDate: seed.workDate,
    registeredBy: IDS.mecCho, executorKind: "yo", executorUserId: IDS.mecCho, executorName: "Pedro Cholguán",
    signedAt: now, receivedAt: now, status: "vigente", notes: "Sin novedad",
    scheduleId: seed.scheduleId, scheduleVersion: 1, scheduleNameSnapshot: seed.scheduleName,
    intervalValue: seed.intervalValue, suggestedIntervalValue: seed.intervalValue,
  })
}

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
  const now = new Date().toISOString()

  // Camión del tipo «Camión» (odómetro) en Cholguán, cuyo perfil fija la unidad en horas.
  await testDb.insert(schema.fuelVehicles).values({
    id: HOURS_TRUCK, code: "KA-410", plate: "HJKL-10", type: "Camión", equipmentTypeId: "fet-test-km",
    worksiteId: IDS.wsCho, isActive: true, model: "R450", year: 2021, brand: "Scania",
  })
  await testDb.insert(schema.mantEquipmentProfiles).values({
    vehicleId: HOURS_TRUCK, brandId: IDS.brandScania, scheduleId: IDS.schH, unit: "h", initialReading: 1_000, initialReadingDate: daysAgo(200),
  })

  // Dos preventivas en horas (la más reciente manda) y una en km MÁS reciente que ambas: no debe leer ni decidir.
  await insertPreventive({
    id: "h-old", folio: "MP-KA410-H1", vehicleId: HOURS_TRUCK, code: "KA-410", plate: "HJKL-10", worksiteId: IDS.wsCho,
    reading: 1_100, unit: "h", workDate: daysAgo(30), scheduleId: IDS.schH, scheduleName: "Maquinaria pesada", intervalValue: 300,
  })
  await insertPreventive({
    id: "h-new", folio: "MP-KA410-H2", vehicleId: HOURS_TRUCK, code: "KA-410", plate: "HJKL-10", worksiteId: IDS.wsCho,
    reading: 1_250, unit: "h", workDate: daysAgo(3), scheduleId: IDS.schH, scheduleName: "Maquinaria pesada", intervalValue: 300,
  })
  await insertPreventive({
    id: "km-of-hours", folio: "MP-KA410-KM1", vehicleId: HOURS_TRUCK, code: "KA-410", plate: "HJKL-10", worksiteId: IDS.wsCho,
    reading: 95_000, unit: "km", workDate: daysAgo(1), scheduleId: IDS.schKm, scheduleName: "Camiones y tractos", intervalValue: 10_000,
  })

  // Camión del MISMO tipo sin unidad fijada (KA-200): sigue en km y su registro en km sí lo lee.
  await insertPreventive({
    id: "cho-km", folio: "MP-KA200-KM1", vehicleId: IDS.truckCho, code: "KA-200", plate: "BCDF-12", worksiteId: IDS.wsCho,
    reading: 20_500, unit: "km", workDate: daysAgo(15), scheduleId: IDS.schKm, scheduleName: "Camiones y tractos", intervalValue: 10_000,
  })

  // Incorporación desde la flota: un tractocamión en Cholguán (producción → horas) y otro en una faena
  // «BIODIVERSA» (→ km). Ninguno tiene perfil todavía.
  await testDb.insert(schema.worksites).values({ id: "ws-bio-camiones", name: "Biodiversa camiones", code: "BIODIVERSA", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.fuelEquipmentTypes).values({
    id: "fet-test-tractor", slug: "t-tractor", name: "Tractocamión", category: "truck", defaultMeterType: "odometer",
    defaultPerformanceUnit: "km_per_liter", performanceFamily: "camiones",
  })
  await testDb.insert(schema.fuelVehicles).values([
    { id: INC_CHOLGUAN, code: "KA-500", plate: "KA-500", type: "Tractocamión", equipmentTypeId: "fet-test-tractor", worksiteId: IDS.wsCho, isActive: true, model: "FH", year: 2022, brand: "Volvo" },
    { id: INC_BIODIVERSA, code: "KA-501", plate: "KA-501", type: "Tractocamión", equipmentTypeId: "fet-test-tractor", worksiteId: "ws-bio-camiones", isActive: true, model: "FH", year: 2022, brand: "Volvo" },
  ])
})

afterAll(async () => {
  await pg.close()
})

describe("unidad por equipo: flota, registros y pautas", () => {
  it("(a) un camión del tipo odómetro con la unidad fijada en horas sale en horas en la flota", async () => {
    const [row] = await loadFleet({ scope: "all", vehicleIds: [HOURS_TRUCK] })
    expect(row?.typeName).toBe("Camión")
    expect(row?.unit).toBe("h")
  })

  it("(b) sólo sus registros en horas leen la lectura y la preventiva; el km más reciente no cuenta", async () => {
    const [row] = await loadFleet({ scope: "all", vehicleIds: [HOURS_TRUCK] })
    // Más reciente primero; el registro en km (95.000, de ayer) queda fuera de la ventana.
    expect(row?.readings.map((reading) => reading.value)).toEqual([1_250, 1_100])
    expect(row?.status.currentReading).toEqual({ value: 1_250, date: daysAgo(3), source: "MP-KA410-H2" })
    expect(row?.recentPreventives.map((preventive) => preventive.folio)).toEqual(["MP-KA410-H2", "MP-KA410-H1"])
    expect(row?.status.lastPreventive?.reading).toBe(1_250)
  })

  it("(b) la validación de un registro nuevo sólo ve la historia de la unidad vigente", async () => {
    const history = await loadVehicleHistory(testDb as unknown as Tx, HOURS_TRUCK)
    expect(history.readings.map((reading) => reading.value).sort((a, b) => a - b)).toEqual([1_100, 1_250])
    expect(history.preventives.map((preventive) => preventive.reading).sort((a, b) => a - b)).toEqual([1_100, 1_250])
  })

  it("(b) el historial del mecánico no mezcla registros de otra unidad", async () => {
    const app = await loadAppHistory(await viewerOf(IDS.mecBio))
    const folios = (app.byVehicle[HOURS_TRUCK] ?? []).map((record) => record.folio).sort()
    expect(folios).toEqual(["MP-KA410-H1", "MP-KA410-H2"])
    expect(app.byVehicle[HOURS_TRUCK]?.every((record) => record.unit === "h")).toBe(true)
  })

  it("(c) otro camión del mismo tipo con la unidad nula sigue en km y su registro en km sí lo lee", async () => {
    const [row] = await loadFleet({ scope: "all", vehicleIds: [IDS.truckCho] })
    expect(row?.unit).toBe("km")
    expect(row?.readings.map((reading) => reading.value)).toEqual([20_500])
    expect(row?.status.currentReading?.value).toBe(20_500)
  })

  it("(d) la pauta en horas ofrece al camión en horas y no al de km del mismo tipo", async () => {
    const hours = await listAssignCandidates(IDS.schH)
    expect(hours?.schedule.unit).toBe("h")
    const hourIds = hours?.candidates.map((candidate) => candidate.vehicleId) ?? []
    expect(hourIds).toContain(HOURS_TRUCK)
    expect(hourIds).toContain(IDS.machineBio)
    expect(hourIds).not.toContain(IDS.truckCho)
    expect(hourIds).not.toContain(IDS.truckBio)

    const km = await listAssignCandidates(IDS.schKm)
    const kmIds = km?.candidates.map((candidate) => candidate.vehicleId) ?? []
    expect(kmIds).toContain(IDS.truckCho)
    expect(kmIds).not.toContain(HOURS_TRUCK)
  })

  it("el conteo de equipos por pauta usa la unidad efectiva del equipo", async () => {
    const schedules = await listSchedules()
    expect(schedules.find((schedule) => schedule.id === IDS.schH)?.equipmentCount).toBe(2)
    expect(schedules.find((schedule) => schedule.id === IDS.schKm)?.equipmentCount).toBe(3)
  })

  it("las opciones de OT muestran la unidad del equipo, no la del tipo", async () => {
    const options = await listWorkOrderEquipmentOptions(await viewerOf(IDS.jefe))
    expect(options.find((option) => option.id === HOURS_TRUCK)?.unit).toBe("h")
    expect(options.find((option) => option.id === IDS.truckCho)?.unit).toBe("km")
  })

  it("la incorporación propone la unidad de la regla de alta y la pauta de esa unidad", async () => {
    const candidates = await listIncorporationCandidates("all")
    expect(candidates.find((candidate) => candidate.vehicleId === INC_CHOLGUAN)).toMatchObject({ unit: "h", suggestedScheduleId: IDS.schH })
    expect(candidates.find((candidate) => candidate.vehicleId === INC_BIODIVERSA)).toMatchObject({ unit: "km", suggestedScheduleId: IDS.schKm })
  })
})
