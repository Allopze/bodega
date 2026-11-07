import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { daysBetween } from "@/lib/mantencion/readings"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { todayInChile } from "@/lib/utils"

/**
 * Panel, estado de equipos y pautas de mantención contra Postgres de verdad
 * (auditoría de código 2026-11-04, carril D):
 *
 * - D1: «Días fuera de servicio» suma los tramos detenidos por una OT, sin contar
 *   dos veces el mismo tramo y con la OT ganando sobre una correctiva abierta.
 * - D2: «En taller ahora» saca «Trabajo» y «Motivo» de la OT que retiene el equipo.
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

const { loadPanel } = await import("@/lib/services/mantencion/panel")
const { addDays } = await import("@/lib/services/mantencion/panel-filters")
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
const VIEWER = { userId: USER, email: null, permissions: ["mant:records:view_all"], worksiteIds: [], isGlobal: true }

const today = todayInChile()
/** Fecha `YYYY-MM-DD` de hace `days` días. */
const day = (days: number) => addDays(today, -days)
/** Instante ISO de hace `days` días: 15:00 UTC, que en Chile siempre cae en la misma fecha civil. */
const at = (days: number) => new Date(`${addDays(today, -days)}T15:00:00Z`).toISOString()

const WS = {
  ot: "ws-d1-ot", open: "ws-d1-open", mix: "ws-d1-mix", long: "ws-d1-long",
  inconsistent: "ws-d1-inc", fresh: "ws-d3-fresh", exit: "ws-d6", d4: "ws-d4",
} as const

const TYPE = { km: "fet-d1-km", none: "fet-d4-none", blocked: "fet-d4-blocked", free: "fet-d4-free" } as const

const V = {
  ot: "v-d1-ot", open: "v-d1-open", mix: "v-d1-mix", long: "v-d1-long", inconsistent: "v-d1-inc",
  fresh: "v-d3-fresh", exit: "v-d6-exit", noMeter: "v-d4-nom", blockedA: "v-d4-b1", blockedB: "v-d4-b2",
} as const

const REC = { open: "rec-d1-open", closed: "rec-d1-closed", inconsistent: "rec-d1-inc", exit: "rec-d6-exit" } as const
const OT = { ot: "ot-d1-ot", mix: "ot-d1-mix", long: "ot-d1-long", inconsistent: "ot-d1-inc", fresh: "ot-d3-fresh" } as const

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
    workshopKind: "interno", workshopEntryAt: input.entryDate, estimatedDeliveryDate: addDays(today, 5),
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
    worksite(WS.ot, "Faena OT"), worksite(WS.open, "Faena correctiva abierta"), worksite(WS.mix, "Faena mixta"),
    worksite(WS.long, "Faena tramo largo"), worksite(WS.inconsistent, "Faena inconsistente"),
    worksite(WS.fresh, "Faena OT al día"), worksite(WS.exit, "Faena dos salidas"), worksite(WS.d4, "Faena pautas"),
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
    vehicle(V.open, "KA-OPE", "RBYD-02", WS.open),
    vehicle(V.mix, "KA-MIX", "RBYD-03", WS.mix),
    vehicle(V.long, "KA-LON", "RBYD-04", WS.long),
    vehicle(V.inconsistent, "KA-INC", "RBYD-07", WS.inconsistent),
    vehicle(V.fresh, "KA-FRE", "RBYD-05", WS.fresh),
    vehicle(V.exit, "KA-EXI", "RBYD-06", WS.exit),
    vehicle(V.noMeter, "MQ-NOM", "MQ-NOM-1", WS.d4, TYPE.none),
    vehicle(V.blockedA, "EX-B1", "RBYD-08", WS.d4, TYPE.blocked),
    vehicle(V.blockedB, "EX-B2", "RBYD-09", WS.d4, TYPE.blocked),
  ])
  await testDb.insert(schema.mantEquipmentProfiles).values(
    [V.ot, V.open, V.mix, V.long, V.inconsistent, V.fresh, V.exit, V.noMeter, V.blockedA, V.blockedB]
      .map((vehicleId) => ({ vehicleId, brandId: "b-d1" })),
  )

  // D1 · una OT de 10 días en taller.
  await insertWorkOrder({
    id: OT.ot, folio: "OT-0001", vehicleId: V.ot, worksiteId: WS.ot, worksiteName: "Faena OT",
    code: "KA-OT", plate: "RBYD-01", entryDate: day(10), updatedAt: at(3),
    repairDescription: "Cambio de bomba hidráulica", observations: "Esperando repuesto del fabricante",
  })

  // D1 · una correctiva abierta de 5 días (aparece en `cases` y en `fleet`: se cuenta una vez).
  await insertCorrective({
    id: REC.open, folio: "MC-0001", vehicleId: V.open, worksiteId: WS.open, worksiteName: "Faena correctiva abierta",
    code: "KA-OPE", plate: "RBYD-02", workDate: day(5), entryDate: day(5),
    description: "Cambio de sello de bomba", reason: "Espera repuesto en faena",
  })

  // D1 · correctiva cerrada de 4 días (ingreso hace 10, salida hace 6) + OT abierta de 6 días.
  await insertCorrective({
    id: REC.closed, folio: "MC-0002", vehicleId: V.mix, worksiteId: WS.mix, worksiteName: "Faena mixta",
    code: "KA-MIX", plate: "RBYD-03", workDate: day(10), entryDate: day(10),
    description: "Reparación de transmisión", reason: "Quedó en taller",
  })
  await testDb.insert(schema.mantWorkshopUpdates).values({
    id: "wu-mix-exit", recordId: REC.closed, kind: "salio", exitDate: day(6), userId: USER, createdAt: at(6),
  })
  await insertWorkOrder({
    id: OT.mix, folio: "OT-0002", vehicleId: V.mix, worksiteId: WS.mix, worksiteName: "Faena mixta",
    code: "KA-MIX", plate: "RBYD-03", entryDate: day(6), updatedAt: at(0),
    repairDescription: "Cambio de rodamiento", observations: "Trabajo en curso",
  })

  // D1 · OT que empezó hace 40 días (para el recorte al período).
  await insertWorkOrder({
    id: OT.long, folio: "OT-0003", vehicleId: V.long, worksiteId: WS.long, worksiteName: "Faena tramo largo",
    code: "KA-LON", plate: "RBYD-04", entryDate: day(40), updatedAt: at(0),
    repairDescription: "Overhaul de motor", observations: "En taller externo",
  })

  // D1 · dato inconsistente: correctiva abierta de 8 días Y OT de 6. La OT manda (6, no 14).
  await insertCorrective({
    id: REC.inconsistent, folio: "MC-0003", vehicleId: V.inconsistent, worksiteId: WS.inconsistent,
    worksiteName: "Faena inconsistente", code: "KA-INC", plate: "RBYD-07", workDate: day(8), entryDate: day(8),
    description: "Cambio de mangueras", reason: "Sin salida registrada",
  })
  await insertWorkOrder({
    id: OT.inconsistent, folio: "OT-0004", vehicleId: V.inconsistent, worksiteId: WS.inconsistent,
    worksiteName: "Faena inconsistente", code: "KA-INC", plate: "RBYD-07", entryDate: day(6), updatedAt: at(0),
    repairDescription: "Cambio de mangueras", observations: "La OT reemplaza a la correctiva",
  })

  // D3 · OT actualizada ayer: no está «sin actualizar».
  await insertWorkOrder({
    id: OT.fresh, folio: "OT-0005", vehicleId: V.fresh, worksiteId: WS.fresh, worksiteName: "Faena OT al día",
    code: "KA-FRE", plate: "RBYD-05", entryDate: day(4), updatedAt: at(1),
    repairDescription: "Ajuste de frenos", observations: "Sin novedad",
  })

  // D6 · dos salidas en días distintos, insertadas de la más nueva a la más antigua.
  await insertCorrective({
    id: REC.exit, folio: "MC-0004", vehicleId: V.exit, worksiteId: WS.exit, worksiteName: "Faena dos salidas",
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

const panelOf = (worksiteId: string, period: "7" | "30" = "30") => loadPanel(VIEWER, { period, worksiteId })

describe("D1 · días fuera de servicio incluye las OT", () => {
  it("una OT de 10 días en un período de 30 suma 10 días y 1 equipo", async () => {
    const data = await panelOf(WS.ot)
    expect(data.stoppedDays).toEqual({ total: 10, equipment: 1 })
    // La misma máquina sí aparecía «En taller»: el defecto era sólo de la cuenta de días.
    expect(data.workshop.equipment).toBe(1)
  })

  it("una correctiva abierta de 5 días se cuenta una sola vez, no una por cada fuente", async () => {
    expect((await panelOf(WS.open)).stoppedDays).toEqual({ total: 5, equipment: 1 })
  })

  it("un tramo cerrado de 4 días y una OT abierta de 6 del mismo equipo suman 10, en 1 equipo", async () => {
    expect((await panelOf(WS.mix)).stoppedDays).toEqual({ total: 10, equipment: 1 })
  })

  it("con una OT abierta, la correctiva abierta del mismo equipo no se suma: la OT manda", async () => {
    // 8 días de correctiva + 6 de OT darían 14 sin la regla; el dato es inconsistente y
    // lo que retiene el equipo es la OT.
    expect((await panelOf(WS.inconsistent)).stoppedDays).toEqual({ total: 6, equipment: 1 })
  })

  it("el tramo se recorta al período: un ingreso de hace 40 días suma los días del período, no 40", async () => {
    const data = await panelOf(WS.long, "7")
    expect(data.from).toBe(day(6))
    // «7 días» incluye hoy y los 6 anteriores: el tramo aporta 6 días de intervalo
    // (misma aritmética que una correctiva cerrada, ver `stoppedDaysWithin`).
    expect(data.stoppedDays).toEqual({ total: 6, equipment: 1 })
  })
})

describe("D2 · «En taller ahora» con los datos de la OT", () => {
  it("una OT en taller trae «Trabajo» y «Motivo» de la orden, no vacíos", async () => {
    const [row] = (await panelOf(WS.ot)).workshop.rows
    expect(row).toMatchObject({
      recordId: OT.ot,
      workOrderId: OT.ot,
      folio: "OT-0001",
      summary: "Cambio de bomba hidráulica",
      reason: "Esperando repuesto del fabricante",
      daysStopped: 10,
    })
    expect(row?.summary).not.toBe("")
    expect(row?.reason).not.toBe("")
  })

  it("una correctiva sigue mostrando su descripción y su motivo de taller", async () => {
    const [row] = (await panelOf(WS.open)).workshop.rows
    expect(row).toMatchObject({
      recordId: REC.open,
      workOrderId: null,
      folio: "MC-0001",
      summary: "Cambio de sello de bomba",
      reason: "Espera repuesto en faena",
    })
  })
})

describe("«En taller ahora» dice si la OT espera un repuesto", () => {
  async function requestParts(input: { id: string; worksiteId: string; vehicleId: string; workOrderId: string; itemStatus: string; requestStatus?: string }) {
    const stamp = new Date().toISOString()
    await testDb.insert(schema.purchaseRequests).values({
      id: input.id, code: `REP-${input.id}`, worksiteId: input.worksiteId, requesterId: USER, requestType: "repuestos",
      status: input.requestStatus ?? "approved", urgency: "high", deliveryMode: "directo_faena", createdAt: stamp, updatedAt: stamp,
    })
    await testDb.insert(schema.purchaseRequestItems).values({
      id: `${input.id}-item`, requestId: input.id, productNameFree: "Bomba hidráulica", quantity: 1, status: input.itemStatus,
      vehicleId: input.vehicleId, workOrderId: input.workOrderId, createdAt: stamp, updatedAt: stamp,
    })
  }

  it("una OT en taller con una línea sin recibir sale con waitingParts; sin pedidos, una recibida o una solicitud cancelada, no", async () => {
    expect((await panelOf(WS.ot)).workshop.rows[0]?.waitingParts).toBe(false)

    await requestParts({ id: "d-parts-ot", worksiteId: WS.ot, vehicleId: V.ot, workOrderId: OT.ot, itemStatus: "in_purchase_order" })
    expect((await panelOf(WS.ot)).workshop.rows[0]).toMatchObject({ workOrderId: OT.ot, waitingParts: true })

    // Todo llegó a faena en la OT al día; la otra solicitud se canceló: ninguna de las dos espera.
    await requestParts({ id: "d-parts-fresh", worksiteId: WS.fresh, vehicleId: V.fresh, workOrderId: OT.fresh, itemStatus: "received", requestStatus: "closed" })
    expect((await panelOf(WS.fresh)).workshop.rows[0]?.waitingParts).toBe(false)
    await requestParts({ id: "d-parts-mix", worksiteId: WS.mix, vehicleId: V.mix, workOrderId: OT.mix, itemStatus: "rejected", requestStatus: "cancelled" })
    expect((await panelOf(WS.mix)).workshop.rows[0]?.waitingParts).toBe(false)
  })

  it("una correctiva en taller no tiene OT que espere: waitingParts es false", async () => {
    expect((await panelOf(WS.open)).workshop.rows[0]).toMatchObject({ workOrderId: null, waitingParts: false })
  })
})

describe("D3 · «sin actualizar» también para una OT", () => {
  it("una OT modificada hace 3 días está sin actualizar; hace 1 día, no", async () => {
    const fleet = await loadFleet({ scope: "all", today })
    const stale = fleet.find((row) => row.vehicleId === V.ot)
    expect(stale?.workshop).toMatchObject({ inWorkshop: true, stale: true, lastActivityDate: day(3) })
    const fresh = fleet.find((row) => row.vehicleId === V.fresh)
    expect(fresh?.workshop).toMatchObject({ inWorkshop: true, stale: false, lastActivityDate: day(1) })
    // El panel y el Excel leen el mismo estado.
    expect((await panelOf(WS.ot)).workshop.rows[0]?.stale).toBe(true)
    expect((await panelOf(WS.fresh)).workshop.rows[0]?.stale).toBe(false)
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
    expect(candidates).toHaveLength(7)
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
