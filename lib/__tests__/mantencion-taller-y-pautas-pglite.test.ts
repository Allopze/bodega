import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { daysBetween } from "@/lib/mantencion/readings"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

/**
 * Estado de taller de los equipos y pautas de mantención contra Postgres de verdad
 * (auditoría de código 2026-11-04, carril D; antes «panel»: el Panel viejo y su
 * `loadPanel` se retiraron y los bloques D1 y D2 con él):
 *
 * - D3: «Sin actualizar» se enciende también para un equipo detenido por una OT.
 * - D4: «N equipos» de una pauta cuenta lo mismo que sus candidatos, y cambiar el
 *   medidor de un tipo con equipos en mantención queda bloqueado.
 * - D5: al restituir un intervalo, el aviso cuenta sólo las actividades visibles.
 * - D6: la salida de taller es la más antigua, aunque las filas lleguen al revés.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

/** El único permiso que usa la acción de tipos de equipo; el resto del archivo no pasa por RBAC. */
const requirePermission = vi.hoisted(() => vi.fn(async () => ({ user: { id: "u-fixture", email: "fixture@chome.test" } })))

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ requirePermission }))

const { loadFleet } = await import("@/lib/services/mantencion/fleet")
const { loadWorkshopCases } = await import("@/lib/services/mantencion/records-workshop")
const { listSchedules, createSchedule, loadScheduleEditor } = await import("@/lib/services/mantencion/schedules")
const {
  addScheduleInterval, addScheduleItem, setScheduleIntervalActive, setScheduleItemActive,
} = await import("@/lib/services/mantencion/schedule-editor")
const { assignEquipment, listAssignCandidates } = await import("@/lib/services/mantencion/schedule-assign")
const { workshopState } = await import("@/lib/mantencion/status")
const { updateFuelEquipmentTypeAction } = await import("@/app/(app)/admin/flota-catalogos/tipos-equipo/actions")

const USER = "u-fixture"
const ACTOR = { userId: USER, email: "fixture@chome.test" }

const today = todayInChile()
/** Fecha `YYYY-MM-DD` de hace `days` días. */
const day = (days: number) => addDaysToPlainDate(today, -days)
/** Instante ISO de hace `days` días: 15:00 UTC, que en Chile siempre cae en la misma fecha civil. */
const at = (days: number) => new Date(`${addDaysToPlainDate(today, -days)}T15:00:00Z`).toISOString()

const WS = { ot: "ws-d1-ot", fresh: "ws-d3-fresh", exit: "ws-d6", d4: "ws-d4" } as const

const TYPE = { km: "fet-d1-km", none: "fet-d4-none", blocked: "fet-d4-blocked", free: "fet-d4-free" } as const

const V = {
  ot: "v-d1-ot", fresh: "v-d3-fresh", exit: "v-d6-exit", noMeter: "v-d4-nom", blockedA: "v-d4-b1", blockedB: "v-d4-b2",
} as const

const REC = { exit: "rec-d6-exit" } as const
const OT = { ot: "ot-d1-ot", fresh: "ot-d3-fresh" } as const

/** Vehículo con su ficha de mantención; el snapshot del equipo es el mismo en registros y OT. */
function snapshot(code: string, plate: string, worksiteName: string) {
  return { code, plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: worksiteName, unit: "km" as const }
}

async function insertCorrective(input: {
  id: string; folio: string; vehicleId: string; worksiteId: string; worksiteName: string; code: string; plate: string
  workDate: string; entryDate: string; description: string; reason: string
}) {
  await testDb.insert(schema.mantRecords).values({
    id: input.id, folio: input.folio, kind: "C", vehicleId: input.vehicleId,
    equipmentSnapshot: snapshot(input.code, input.plate, input.worksiteName),
    worksiteId: input.worksiteId, reading: 20_000, unit: "km", workDate: input.workDate,
    registeredBy: USER, executorKind: "yo", executorUserId: USER, executorName: "Mecánico de Prueba",
    signedAt: at(0), receivedAt: at(0),
  })
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId: input.id, workTypes: ["Mecánico"], oils: [], description: input.description, noParts: true, hours: 4,
    inWorkshop: true, workshopEntryDate: input.entryDate, workshopReason: input.reason,
  })
}

async function insertWorkOrder(input: {
  id: string; folio: string; vehicleId: string; worksiteId: string; worksiteName: string; code: string; plate: string
  entryDate: string; updatedAt: string; repairDescription: string; observations: string
}) {
  await testDb.insert(schema.mantWorkOrders).values({
    id: input.id, folio: input.folio, vehicleId: input.vehicleId, worksiteId: input.worksiteId,
    equipmentSnapshot: snapshot(input.code, input.plate, input.worksiteName),
    repair: true, maintenance: false, requestDate: input.entryDate,
    requestedByUserId: USER, requesterName: "Jefatura de Prueba",
    repairDescription: input.repairDescription, observations: input.observations,
    status: "en_ejecucion", assignedToUserId: USER, assignedByUserId: USER, assignedAt: at(45),
    workshopKind: "interno", workshopEntryAt: input.entryDate, estimatedDeliveryDate: addDaysToPlainDate(today, 5),
    startedAt: input.entryDate, startedByUserId: USER,
    createdAt: at(45), updatedAt: input.updatedAt,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  const worksite = (id: string, name: string) => ({ id, name, code: id.toUpperCase(), isActive: true, createdAt: now, updatedAt: now })

  await testDb.insert(schema.users).values({ id: USER, name: "Fixture Mantención", email: ACTOR.email, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([
    worksite(WS.ot, "Faena OT"), worksite(WS.fresh, "Faena OT al día"), worksite(WS.exit, "Faena dos salidas"), worksite(WS.d4, "Faena pautas"),
  ])
  await testDb.insert(schema.fuelEquipmentTypes).values([
    { id: TYPE.km, slug: "d1-km", name: "Camión D1", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" },
    { id: TYPE.none, slug: "d4-none", name: "Remolque D4", category: "support", defaultMeterType: "none", defaultPerformanceUnit: "not_applicable" },
    { id: TYPE.blocked, slug: "d4-blocked", name: "Excavadora D4", category: "heavy", defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour" },
    { id: TYPE.free, slug: "d4-free", name: "Sin equipos D4", category: "other", defaultMeterType: "none", defaultPerformanceUnit: "not_applicable" },
  ])
  await testDb.insert(schema.mantBrands).values({ id: "b-d1", name: "Scania", nameKey: "scania" })

  const vehicle = (id: string, code: string, plate: string, worksiteId: string, typeId: string = TYPE.km) => ({
    id, code, plate, type: "Camión", equipmentTypeId: typeId, worksiteId, model: "R450", year: 2021, brand: "Scania",
  })
  await testDb.insert(schema.fuelVehicles).values([
    vehicle(V.ot, "KA-OT", "RBYD-01", WS.ot),
    vehicle(V.fresh, "KA-FRE", "RBYD-05", WS.fresh),
    vehicle(V.exit, "KA-EXI", "RBYD-06", WS.exit),
    vehicle(V.noMeter, "MQ-NOM", "MQ-NOM-1", WS.d4, TYPE.none),
    vehicle(V.blockedA, "EX-B1", "RBYD-08", WS.d4, TYPE.blocked),
    vehicle(V.blockedB, "EX-B2", "RBYD-09", WS.d4, TYPE.blocked),
  ])
  await testDb.insert(schema.mantEquipmentProfiles).values(
    [V.ot, V.fresh, V.exit, V.noMeter, V.blockedA, V.blockedB]
      .map((vehicleId) => ({ vehicleId, brandId: "b-d1" })),
  )

  // D3 · una OT en taller, modificada por última vez hace 3 días: sin actualizar.
  await insertWorkOrder({
    id: OT.ot, folio: "OT-0001", vehicleId: V.ot, worksiteId: WS.ot, worksiteName: "Faena OT",
    code: "KA-OT", plate: "RBYD-01", entryDate: day(10), updatedAt: at(3),
    repairDescription: "Cambio de bomba hidráulica", observations: "Esperando repuesto del fabricante",
  })

  // D3 · OT actualizada ayer: no está «sin actualizar».
  await insertWorkOrder({
    id: OT.fresh, folio: "OT-0002", vehicleId: V.fresh, worksiteId: WS.fresh, worksiteName: "Faena OT al día",
    code: "KA-FRE", plate: "RBYD-05", entryDate: day(4), updatedAt: at(1),
    repairDescription: "Ajuste de frenos", observations: "Sin novedad",
  })

  // D6 · dos salidas en días distintos, insertadas de la más nueva a la más antigua.
  await insertCorrective({
    id: REC.exit, folio: "MC-0001", vehicleId: V.exit, worksiteId: WS.exit, worksiteName: "Faena dos salidas",
    code: "KA-EXI", plate: "RBYD-06", workDate: day(20), entryDate: day(20),
    description: "Soldadura de soporte", reason: "Se quedó en taller",
  })
  await testDb.insert(schema.mantWorkshopUpdates).values([
    { id: "wu-exit-new", recordId: REC.exit, kind: "salio", exitDate: day(5), userId: USER, createdAt: at(5) },
    { id: "wu-exit-old", recordId: REC.exit, kind: "salio", exitDate: day(10), userId: USER, createdAt: at(10) },
  ])
})

/** Falla la prueba si el servicio rechazó la operación, y devuelve el resultado estrechado al éxito. */
function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${(result as { message?: string }).message}`)
  return result as Extract<T, { ok: true }>
}


describe("D3 · «sin actualizar» también para una OT", () => {
  it("una OT modificada hace 3 días está sin actualizar; hace 1 día, no", async () => {
    const fleet = await loadFleet({ scope: "all", today })
    const stale = fleet.find((row) => row.vehicleId === V.ot)
    expect(stale?.workshop).toMatchObject({ inWorkshop: true, stale: true, lastActivityDate: day(3) })
    const fresh = fleet.find((row) => row.vehicleId === V.fresh)
    expect(fresh?.workshop).toMatchObject({ inWorkshop: true, stale: false, lastActivityDate: day(1) })
  })
})

describe("D6 · salida de taller determinista", () => {
  const base = { inWorkshop: true, entryDate: day(20), workDate: day(20) }
  const exits = [
    { kind: "salio" as const, createdDate: day(5), exitDate: day(5) },
    { kind: "salio" as const, createdDate: day(10), exitDate: day(10) },
  ]

  it("con dos «salio» gana el más antiguo, vengan en el orden que vengan", () => {
    expect(workshopState({ ...base, updates: exits }, today)).toMatchObject({ inWorkshop: false, exitDate: day(10), daysStopped: 10 })
    expect(workshopState({ ...base, updates: [...exits].reverse() }, today)).toMatchObject({ inWorkshop: false, exitDate: day(10), daysStopped: 10 })
  })

  it("los tramos de taller del panel y del detalle usan esa misma salida", async () => {
    const cases = await loadWorkshopCases(eq(schema.mantRecords.worksiteId, WS.exit), today)
    expect(cases).toHaveLength(1)
    // Las dos filas se insertaron de la más nueva a la más antigua: sin orden explícito
    // la salida dependía del plan de la consulta.
    expect(cases[0]?.state).toMatchObject({ inWorkshop: false, exitDate: day(10), daysStopped: 10 })
    expect(daysBetween(cases[0]!.entryDate!, cases[0]!.state.exitDate!)).toBe(10)
  })
})

describe("D4 · medidor del tipo y pautas", () => {
  it("«N equipos» de la pauta cuenta lo mismo que sus candidatos: los que tienen unidad de medida", async () => {
    const created = ok(await createSchedule(ACTOR, { name: "Pauta D4 km", unit: "km", intervals: [10_000], copyFromId: null }))
    const scheduleId = created.data.id
    const candidates = (await listAssignCandidates(scheduleId))!.candidates
    ok(await assignEquipment(ACTOR, { scheduleId, vehicleIds: candidates.map((candidate) => candidate.vehicleId) }))
    // Un equipo de un tipo sin medidor quedó con la pauta (dato viejo): antes inflaba el conteo.
    await testDb.update(schema.mantEquipmentProfiles).set({ scheduleId }).where(eq(schema.mantEquipmentProfiles.vehicleId, V.noMeter))

    const row = (await listSchedules()).find((item) => item.id === scheduleId)!
    expect(candidates).toHaveLength(3)
    expect(row.equipmentCount).toBe(candidates.length)
  })

  const previous = { ok: false, message: "" }

  function typeForm(id: string, name: string, category: string, meter: string, performance: string) {
    const data = new FormData()
    data.append("id", id)
    data.append("name", name)
    data.append("category", category)
    data.append("defaultMeterType", meter)
    data.append("defaultPerformanceUnit", performance)
    data.append("sortOrder", "0")
    return data
  }

  it("bloquea el cambio de medidor si el tipo tiene equipos activos en mantención", async () => {
    const result = await updateFuelEquipmentTypeAction(
      previous,
      typeForm(TYPE.blocked, "Excavadora D4", "heavy", "none", "not_applicable"),
    )
    expect(result.ok).toBe(false)
    expect(result.message).toBe("No puedes cambiar el medidor: 2 equipos en mantención quedarían sin unidad. Reasígnalos o dalos de baja primero.")
    const [row] = await testDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.id, TYPE.blocked))
    expect(row?.defaultMeterType).toBe("hour_meter")
  })

  it("permite el cambio si el tipo no tiene equipos en mantención", async () => {
    const result = await updateFuelEquipmentTypeAction(
      previous,
      typeForm(TYPE.free, "Sin equipos D4", "other", "odometer", "km_per_liter"),
    )
    expect(result).toEqual({ ok: true, message: "Tipo de equipo actualizado" })
    const [row] = await testDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.id, TYPE.free))
    expect(row?.defaultMeterType).toBe("odometer")
  })
})

describe("D5 · fillMissingCells cuenta sólo las actividades visibles", () => {
  let scheduleId = ""
  let groupId = ""
  let interval20 = ""
  let hiddenItem = ""

  beforeAll(async () => {
    const created = ok(await createSchedule(ACTOR, { name: "Pauta D5", unit: "km", intervals: [10_000, 20_000], copyFromId: null }))
    scheduleId = created.data.id
    const first = ok(await addScheduleItem(ACTOR, { scheduleId, groupName: "Motor", name: "Revisión aceite" }))
    if (!first.data) throw new Error("El alta del ítem no devolvió sus identificadores")
    groupId = first.data.groupId
    interval20 = (await loadScheduleEditor(scheduleId))!.intervals.find((interval) => interval.value === 20_000)!.id
    // El intervalo se quita ANTES de crear el ítem: éste nace sin celda en esa columna.
    ok(await setScheduleIntervalActive(ACTOR, { scheduleId, intervalId: interval20, active: false }))
    const hidden = ok(await addScheduleItem(ACTOR, { scheduleId, groupId, name: "Ítem que se quita" }))
    if (!hidden.data) throw new Error("El alta del ítem no devolvió sus identificadores")
    hiddenItem = hidden.data.itemId
    ok(await setScheduleItemActive(ACTOR, { scheduleId, itemId: hiddenItem, active: false }))
  })

  it("un ítem inactivo recibe su celda pero no se anuncia como actividad nueva", async () => {
    const restored = ok(await addScheduleInterval(ACTOR, { scheduleId, value: 20_000 }))
    expect(restored.message).toBe("Intervalo de 20.000 km restituido con su columna.")
    // La celda se crea igual: es lo que el ítem recupera si se restituye.
    const cells = await testDb.select().from(schema.mantScheduleItemIntervals)
      .where(eq(schema.mantScheduleItemIntervals.itemId, hiddenItem))
    expect(cells.some((cell) => cell.intervalId === interval20)).toBe(true)
    expect((await loadScheduleEditor(scheduleId))!.intervals.find((interval) => interval.id === interval20)?.needsReview).toBe(false)
  })

  it("una actividad visible sí se anuncia y deja la columna por revisar", async () => {
    ok(await setScheduleIntervalActive(ACTOR, { scheduleId, intervalId: interval20, active: false }))
    ok(await addScheduleItem(ACTOR, { scheduleId, groupId, name: "Frenos de servicio" }))
    const restored = ok(await addScheduleInterval(ACTOR, { scheduleId, value: 20_000 }))
    expect(restored.message).toBe("Intervalo de 20.000 km restituido con su columna. 1 actividad nueva heredó su valor de la columna de 10.000 km. Revisa la columna.")
    expect((await loadScheduleEditor(scheduleId))!.intervals.find((interval) => interval.id === interval20)?.needsReview).toBe(true)
  })
})
