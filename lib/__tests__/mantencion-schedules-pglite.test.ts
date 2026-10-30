import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import ExcelJS from "exceljs"
import { and, eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { getScheduleSnapshot } from "@/lib/services/mantencion/schedule-versions"

/*
 * Pautas (§10, regla 15) contra Postgres de verdad: cada edición sube la
 * versión y guarda su snapshot sin tocar el de las versiones anteriores; un
 * intervalo nuevo hereda la columna y queda por revisar; quitar es inactivar y
 * deshacer lo restituye; la asignación resume y registra su historial; eliminar
 * deja a los equipos sin pauta.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const {
  createSchedule, deleteSchedule, listSchedules, loadScheduleEditor, parseIntervalList,
} = await import("@/lib/services/mantencion/schedules")
const {
  renameSchedule, setScheduleCell, addScheduleItem, setScheduleItemActive, addScheduleInterval,
  setScheduleIntervalActive, clearIntervalReview, setScheduleBrandRule,
} = await import("@/lib/services/mantencion/schedule-editor")
const { assignEquipment, listAssignCandidates } = await import("@/lib/services/mantencion/schedule-assign")
const { listEquipmentHistory } = await import("@/lib/services/mantencion/equipment-history")
const { exportSchedules } = await import("@/lib/services/mantencion/export-schedules")
const { exportEquipment } = await import("@/lib/services/mantencion/export-equipment")

const actor = { userId: "u-jefe-pauta", email: "jefe@example.test" }
const T = { camion: "t-camion", tracto: "t-tracto", excavadora: "t-excavadora" } as const
const WS = { arauco: "ws-arauco", teno: "ws-teno" } as const
const BRAND = { scania: "b-scania", volvo: "b-volvo" } as const

let sourceId = ""

async function audits(entityType: string) {
  return testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, entityType))
}

async function versionRows(scheduleId: string) {
  return testDb.select().from(schema.mantScheduleVersions).where(eq(schema.mantScheduleVersions.scheduleId, scheduleId))
}

/** Falla la prueba si el servicio rechazó la operación, y devuelve el resultado ya estrechado a la rama de éxito. */
function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${(result as { message?: string }).message}`)
  return result as Extract<T, { ok: true }>
}

/** Id del ítem que acaba de agregar `addScheduleItem` (el servicio lo devuelve en `data`). */
function newItemId(result: { data?: { itemId: string } }): string {
  if (!result.data) throw new Error("La edición del ítem no devolvió sus identificadores")
  return result.data.itemId
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: actor.userId, name: "Jefatura Pautas", email: actor.email, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([
    { id: WS.arauco, name: "Arauco", code: "FN-ARA", isActive: true },
    { id: WS.teno, name: "Teno", code: "FN-TEN", isActive: true },
  ])
  await testDb.insert(schema.fuelEquipmentTypes).values([
    { id: T.camion, slug: "p-camion", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" },
    { id: T.tracto, slug: "p-tracto", name: "Tracto", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" },
    { id: T.excavadora, slug: "p-excavadora", name: "Excavadora", category: "heavy", defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour" },
  ])
  await testDb.insert(schema.mantBrands).values([
    { id: BRAND.scania, name: "Scania", nameKey: "scania" },
    { id: BRAND.volvo, name: "Volvo", nameKey: "volvo" },
  ])
  await testDb.insert(schema.fuelVehicles).values([
    { id: "v-1", plate: "BCDF-11", code: "KA-1", type: "p-camion", equipmentTypeId: T.camion, worksiteId: WS.arauco },
    { id: "v-2", plate: "BCDF-12", code: "KA-2", type: "p-camion", equipmentTypeId: T.camion, worksiteId: WS.arauco },
    { id: "v-3", plate: "BCDF-13", code: "KA-3", type: "p-tracto", equipmentTypeId: T.tracto, worksiteId: WS.teno },
    { id: "v-4", plate: "BCDF-14", code: "KA-4", type: "p-tracto", equipmentTypeId: T.tracto, worksiteId: WS.teno, isActive: false },
    { id: "v-5", plate: "MQ-5", code: "MQ-5", type: "p-excavadora", equipmentTypeId: T.excavadora, worksiteId: WS.teno },
  ])
  await testDb.insert(schema.mantEquipmentProfiles).values([
    { vehicleId: "v-1", brandId: BRAND.scania }, { vehicleId: "v-2", brandId: BRAND.scania },
    { vehicleId: "v-3", brandId: BRAND.volvo }, { vehicleId: "v-4", brandId: BRAND.volvo }, { vehicleId: "v-5", brandId: BRAND.volvo },
  ])
})

describe("crear", () => {
  it("una pauta vacía publica la versión 1 con su snapshot y auditoría", async () => {
    const created = ok(await createSchedule(actor, { name: "  Camiones   base ", unit: "km", intervals: [20000, 10000, 40000], copyFromId: null }))
    sourceId = created.data.id
    const [row] = await testDb.select().from(schema.mantSchedules).where(eq(schema.mantSchedules.id, sourceId))
    expect(row).toMatchObject({ name: "Camiones base", unit: "km", version: 1 })
    const snapshot = await getScheduleSnapshot(sourceId, 1)
    expect(snapshot).toMatchObject({ name: "Camiones base", version: 1, intervals: [10000, 20000, 40000], groups: [] })
    expect(await audits("mant_schedule")).toHaveLength(1)
  })

  it("rechaza un nombre repetido (normalizado) y una lista de intervalos vacía", async () => {
    expect(await createSchedule(actor, { name: "CAMIONES BASE", unit: "km", intervals: [10000], copyFromId: null })).toMatchObject({ ok: false, field: "name" })
    expect(await createSchedule(actor, { name: "Otra", unit: "km", intervals: [], copyFromId: null })).toMatchObject({ ok: false, field: "intervals" })
  })

  it("interpreta la lista de intervalos con miles y separadores", () => {
    expect(parseIntervalList("10.000, 20000 40000;10000")).toEqual([10000, 20000, 40000])
    expect(parseIntervalList("abc")).toBeNull()
    expect(parseIntervalList("0")).toBeNull()
    expect(parseIntervalList("")).toBeNull()
  })
})

describe("ediciones: versión y snapshot (regla 15)", () => {
  let itemId = ""
  let groupId = ""
  it("agregar un ítem sube la versión y crea el sistema; el snapshot nuevo lo trae y el anterior queda intacto", async () => {
    const before = await getScheduleSnapshot(sourceId, 1)
    const added = ok(await addScheduleItem(actor, { scheduleId: sourceId, groupName: "Motor", name: "Inspección visual" }))
    if (!added.data) throw new Error("La edición del ítem no devolvió sus identificadores")
    itemId = added.data.itemId
    groupId = added.data.groupId
    expect(added.version).toBe(2)
    const v2 = await getScheduleSnapshot(sourceId, 2)
    expect(v2?.groups).toEqual([{ name: "Motor", items: [{ key: expect.stringMatching(/^x/), name: "Inspección visual", applies: [true, true, true] }] }])
    expect(await getScheduleSnapshot(sourceId, 1)).toEqual(before)
    expect(before?.groups).toEqual([])
    const versions = await versionRows(sourceId)
    expect(versions.map((row) => row.version).sort()).toEqual([1, 2])
    expect((await testDb.select().from(schema.mantSchedules).where(eq(schema.mantSchedules.id, sourceId)))[0]?.version).toBe(2)
  })

  it("rechaza un ítem repetido en el mismo sistema", async () => {
    expect(await addScheduleItem(actor, { scheduleId: sourceId, groupId, name: "inspección  VISUAL" })).toMatchObject({ ok: false })
    const model = await loadScheduleEditor(sourceId)
    expect(model?.version).toBe(2)
  })

  it("marcar una celda sube la versión y sólo cambia esa columna", async () => {
    const model = (await loadScheduleEditor(sourceId))!
    const interval = model.intervals.find((item) => item.value === 20000)!
    const result = ok(await setScheduleCell(actor, { scheduleId: sourceId, itemId, intervalId: interval.id, applies: false }))
    expect(result.version).toBe(3)
    expect((await getScheduleSnapshot(sourceId, 3))?.groups[0]?.items[0]?.applies).toEqual([true, false, true])
    expect((await getScheduleSnapshot(sourceId, 2))?.groups[0]?.items[0]?.applies).toEqual([true, true, true])
  })

  it("quitar un ítem lo inactiva (no lo borra) y deshacer lo restituye con su columna", async () => {
    const removed = ok(await setScheduleItemActive(actor, { scheduleId: sourceId, itemId, active: false }))
    expect(removed.version).toBe(4)
    expect((await getScheduleSnapshot(sourceId, 4))?.groups).toEqual([])
    const [row] = await testDb.select().from(schema.mantScheduleItems).where(eq(schema.mantScheduleItems.id, itemId))
    expect(row?.isActive).toBe(false)
    expect((await loadScheduleEditor(sourceId))?.groups).toEqual([])
    // Las versiones viejas siguen mostrando el ítem: un registro firmado no cambia.
    expect((await getScheduleSnapshot(sourceId, 3))?.groups[0]?.items).toHaveLength(1)

    const restored = ok(await setScheduleItemActive(actor, { scheduleId: sourceId, itemId, active: true }))
    expect(restored.version).toBe(5)
    expect((await getScheduleSnapshot(sourceId, 5))?.groups[0]?.items[0]?.applies).toEqual([true, false, true])
  })

  it("cambiar el nombre sube la versión y respeta la unicidad", async () => {
    await createSchedule(actor, { name: "Otra pauta km", unit: "km", intervals: [5000], copyFromId: null })
    expect(await renameSchedule(actor, sourceId, "otra PAUTA km")).toMatchObject({ ok: false, field: "name" })
    const renamed = ok(await renameSchedule(actor, sourceId, "Camiones y tractos"))
    expect(renamed.version).toBe(6)
    expect((await getScheduleSnapshot(sourceId, 6))?.name).toBe("Camiones y tractos")
    expect((await getScheduleSnapshot(sourceId, 5))?.name).toBe("Camiones base")
  })
})

describe("intervalos (regla 15)", () => {
  it("un intervalo nuevo hereda la columna del mayor que lo divide y queda por revisar", async () => {
    const before = (await loadScheduleEditor(sourceId))!
    const added = ok(await addScheduleInterval(actor, { scheduleId: sourceId, value: 80000 }))
    expect(added.version).toBe(7)
    const model = (await loadScheduleEditor(sourceId))!
    expect(model.intervals.map((item) => item.value)).toEqual([10000, 20000, 40000, 80000])
    expect(model.intervals.find((item) => item.value === 80000)?.needsReview).toBe(true)
    // 80.000 lo dividen 10.000, 20.000 y 40.000: hereda la de 40.000 (el ítem aplica ahí).
    const item = model.groups[0]!.items[0]!
    const column = (value: number) => item.applies[model.intervals.find((interval) => interval.value === value)!.id]
    expect(column(80000)).toBe(column(40000))
    expect(column(80000)).toBe(true)
    expect(before.intervals).toHaveLength(3)
    expect((await getScheduleSnapshot(sourceId, 7))?.intervals).toEqual([10000, 20000, 40000, 80000])
    expect((await getScheduleSnapshot(sourceId, 6))?.intervals).toEqual([10000, 20000, 40000])
  })

  it("hereda de la columna de 20.000 (que el ítem no tiene) cuando 60.000 sólo lo divide 20.000", async () => {
    // 60.000: lo dividen 10.000 y 20.000 (no 40.000 ni 80.000): hereda 20.000, donde el ítem NO aplica.
    ok(await addScheduleInterval(actor, { scheduleId: sourceId, value: 60000 }))
    const model = (await loadScheduleEditor(sourceId))!
    const item = model.groups[0]!.items[0]!
    expect(item.applies[model.intervals.find((interval) => interval.value === 60000)!.id]).toBe(false)
  })

  it("tocar una celda de la columna la da por revisada, y el botón limpia las demás", async () => {
    const model = (await loadScheduleEditor(sourceId))!
    const interval80 = model.intervals.find((item) => item.value === 80000)!
    ok(await setScheduleCell(actor, { scheduleId: sourceId, itemId: model.groups[0]!.items[0]!.id, intervalId: interval80.id, applies: true }))
    const after = (await loadScheduleEditor(sourceId))!
    expect(after.intervals.find((item) => item.value === 80000)?.needsReview).toBe(false)
    expect(after.intervals.find((item) => item.value === 60000)?.needsReview).toBe(true)
    ok(await clearIntervalReview(actor, { scheduleId: sourceId }))
    expect((await loadScheduleEditor(sourceId))!.intervals.some((item) => item.needsReview)).toBe(false)
  })

  it("quitar un intervalo lo inactiva, deshacer lo restituye y la pauta conserva al menos uno", async () => {
    const model = (await loadScheduleEditor(sourceId))!
    const sixty = model.intervals.find((item) => item.value === 60000)!
    const version = (await testDb.select().from(schema.mantSchedules).where(eq(schema.mantSchedules.id, sourceId)))[0]!.version
    const removed = ok(await setScheduleIntervalActive(actor, { scheduleId: sourceId, intervalId: sixty.id, active: false }))
    expect(removed.version).toBe(version + 1)
    expect((await getScheduleSnapshot(sourceId, removed.version))?.intervals).toEqual([10000, 20000, 40000, 80000])
    const restored = ok(await setScheduleIntervalActive(actor, { scheduleId: sourceId, intervalId: sixty.id, active: true }))
    expect((await getScheduleSnapshot(sourceId, restored.version))?.intervals).toEqual([10000, 20000, 40000, 60000, 80000])

    const single = ok(await createSchedule(actor, { name: "Un solo intervalo", unit: "h", intervals: [250], copyFromId: null }))
    const only = (await loadScheduleEditor(single.data.id))!.intervals[0]!
    expect(await setScheduleIntervalActive(actor, { scheduleId: single.data.id, intervalId: only.id, active: false })).toMatchObject({ ok: false, message: "La pauta necesita al menos un intervalo." })
  })

  it("agregar de nuevo un intervalo quitado lo reactiva sin duplicar la fila y sin volver a marcarlo por revisar", async () => {
    const model = (await loadScheduleEditor(sourceId))!
    const eighty = model.intervals.find((item) => item.value === 80000)!
    ok(await setScheduleIntervalActive(actor, { scheduleId: sourceId, intervalId: eighty.id, active: false }))
    const restored = ok(await addScheduleInterval(actor, { scheduleId: sourceId, value: 80000 }))
    expect(restored.message).toBe("Intervalo de 80.000 km restituido con su columna.")
    expect(restored.data).toMatchObject({ intervalId: eighty.id, restored: true })
    const rows = await testDb.select().from(schema.mantScheduleIntervals)
      .where(and(eq(schema.mantScheduleIntervals.scheduleId, sourceId), eq(schema.mantScheduleIntervals.value, 80000)))
    expect(rows).toHaveLength(1)
    // La columna ya estaba revisada al quitarla: vuelve tal cual, no como una columna nueva.
    expect(rows[0]).toMatchObject({ isActive: true, needsReview: false })
    expect(await addScheduleInterval(actor, { scheduleId: sourceId, value: 80000 })).toMatchObject({ ok: false, field: "value" })
  })

  it("restituir un intervalo devuelve SU columna intacta, aunque difiera de la que heredaría de otro", async () => {
    const model = (await loadScheduleEditor(sourceId))!
    const eighty = model.intervals.find((item) => item.value === 80000)!
    const fortyK = model.intervals.find((item) => item.value === 40000)!
    const item = model.groups[0]!.items[0]!
    // En 40.000 el ítem aplica; en 80.000 lo desmarcamos: si «restituir» copiara otra columna, volvería marcado.
    expect(item.applies[fortyK.id]).toBe(true)
    ok(await setScheduleCell(actor, { scheduleId: sourceId, itemId: item.id, intervalId: eighty.id, applies: false }))
    const cellsBefore = await testDb.select().from(schema.mantScheduleItemIntervals).where(eq(schema.mantScheduleItemIntervals.intervalId, eighty.id))

    ok(await setScheduleIntervalActive(actor, { scheduleId: sourceId, intervalId: eighty.id, active: false }))
    const restored = ok(await addScheduleInterval(actor, { scheduleId: sourceId, value: 80000 }))
    expect(restored.message).toBe("Intervalo de 80.000 km restituido con su columna.")

    const cellsAfter = await testDb.select().from(schema.mantScheduleItemIntervals).where(eq(schema.mantScheduleItemIntervals.intervalId, eighty.id))
    expect(cellsAfter).toEqual(cellsBefore)
    expect((await loadScheduleEditor(sourceId))!.groups[0]!.items[0]!.applies[eighty.id]).toBe(false)
    const snapshot = await getScheduleSnapshot(sourceId, restored.version)
    expect(snapshot?.intervals).toEqual([10000, 20000, 40000, 60000, 80000])
    expect(snapshot?.groups[0]?.items[0]?.applies).toEqual([true, false, true, expect.any(Boolean), false])
    // Sin ítems nuevos entre medio no hay nada que heredar: la columna no queda por revisar.
    expect((await loadScheduleEditor(sourceId))!.intervals.find((interval) => interval.id === eighty.id)?.needsReview).toBe(false)
  })

  it("un ítem que nació mientras el intervalo estaba quitado hereda al volver y deja la columna por revisar", async () => {
    const model = (await loadScheduleEditor(sourceId))!
    const eighty = model.intervals.find((item) => item.value === 80000)!
    const group = model.groups[0]!
    const cellOf = async (itemId: string) => (await testDb.select().from(schema.mantScheduleItemIntervals)
      .where(and(eq(schema.mantScheduleItemIntervals.itemId, itemId), eq(schema.mantScheduleItemIntervals.intervalId, eighty.id))))[0]

    // Vía «Agregar intervalo»: el ítem nuevo no tenía celda en 80.000.
    ok(await setScheduleIntervalActive(actor, { scheduleId: sourceId, intervalId: eighty.id, active: false }))
    const frenos = newItemId(ok(await addScheduleItem(actor, { scheduleId: sourceId, groupId: group.id, name: "Frenos de prueba" })))
    expect(await cellOf(frenos)).toBeUndefined()
    const restored = ok(await addScheduleInterval(actor, { scheduleId: sourceId, value: 80000 }))
    expect(restored.message).toBe("Intervalo de 80.000 km restituido con su columna. 1 actividad nueva heredó su valor de la columna de 40.000 km. Revisa la columna.")
    expect(await cellOf(frenos)).toMatchObject({ applies: true })
    expect((await loadScheduleEditor(sourceId))!.intervals.find((interval) => interval.id === eighty.id)?.needsReview).toBe(true)

    // Vía «Deshacer» (restituir con la misma acción de quitar): también devuelve la columna sin huecos.
    ok(await clearIntervalReview(actor, { scheduleId: sourceId }))
    ok(await setScheduleIntervalActive(actor, { scheduleId: sourceId, intervalId: eighty.id, active: false }))
    const luces = newItemId(ok(await addScheduleItem(actor, { scheduleId: sourceId, groupId: group.id, name: "Luces de prueba" })))
    expect(await cellOf(luces)).toBeUndefined()
    ok(await setScheduleIntervalActive(actor, { scheduleId: sourceId, intervalId: eighty.id, active: true }))
    expect(await cellOf(luces)).toMatchObject({ applies: true })
    expect(await cellOf(frenos)).toMatchObject({ applies: true })
    expect((await loadScheduleEditor(sourceId))!.intervals.find((interval) => interval.id === eighty.id)?.needsReview).toBe(true)

    // Deja la pauta como estaba para las pruebas que siguen.
    ok(await setScheduleItemActive(actor, { scheduleId: sourceId, itemId: frenos, active: false }))
    ok(await setScheduleItemActive(actor, { scheduleId: sourceId, itemId: luces, active: false }))
    ok(await clearIntervalReview(actor, { scheduleId: sourceId }))
  })
})

describe("copia y reglas por marca", () => {
  it("copiar conserva sistemas, ítems y claves; un intervalo distinto hereda y queda por revisar", async () => {
    const copy = ok(await createSchedule(actor, { name: "Copia de camiones", unit: "km", intervals: [10000, 30000], copyFromId: sourceId }))
    const model = (await loadScheduleEditor(copy.data.id))!
    expect(model.origin).toMatch(/^Copia de «Camiones y tractos»\./)
    expect(model.groups.map((group) => group.name)).toEqual(["Motor"])
    expect(model.groups[0]!.items.map((item) => item.name)).toEqual(["Inspección visual"])
    expect(model.intervals.map((item) => [item.value, item.needsReview])).toEqual([[10000, false], [30000, true]])
    // 30.000 lo divide 10.000: hereda su columna.
    const item = model.groups[0]!.items[0]!
    expect(Object.values(item.applies)).toEqual([true, true])
    const source = (await loadScheduleEditor(sourceId))!
    expect(item.key).toBe(source.groups[0]!.items[0]!.key)
    expect(await getScheduleSnapshot(copy.data.id, 1)).toMatchObject({ version: 1, intervals: [10000, 30000] })
  })

  it("no se copia una pauta de otra unidad", async () => {
    const horas = ok(await createSchedule(actor, { name: "Maquinaria", unit: "h", intervals: [300, 600], copyFromId: null }))
    expect(await createSchedule(actor, { name: "Mal copia", unit: "km", intervals: [10000], copyFromId: horas.data.id })).toMatchObject({ ok: false, field: "copyFromId" })
  })

  it("la regla por marca se edita por celda y sube la versión", async () => {
    const model = (await loadScheduleEditor(sourceId))!
    const item = model.groups[0]!.items[0]!
    await testDb.insert(schema.mantScheduleBrandRules).values({ id: "rule-1", scheduleId: sourceId, itemId: item.id, sheetActivity: "Inspección visual", brandId: BRAND.scania, value: "A" })
    await testDb.insert(schema.mantScheduleBrandRules).values({ id: "rule-2", scheduleId: sourceId, itemId: item.id, sheetActivity: "Inspección visual", brandId: BRAND.volvo, value: "A" })
    const result = ok(await setScheduleBrandRule(actor, { scheduleId: sourceId, activity: "Inspección visual", brandId: BRAND.scania, value: "X" }))
    const snapshot = await getScheduleSnapshot(sourceId, result.version)
    expect(snapshot?.brandRules).toEqual(expect.arrayContaining([{ itemKey: item.key, brandId: BRAND.scania, value: "X" }, { itemKey: item.key, brandId: BRAND.volvo, value: "A" }]))
    const reloaded = (await loadScheduleEditor(sourceId))!
    expect(reloaded.brandRules.rows[0]).toMatchObject({ activity: "Inspección visual", inSchedule: true, values: { [BRAND.scania]: "X", [BRAND.volvo]: "A" } })
    expect(await setScheduleBrandRule(actor, { scheduleId: sourceId, activity: "No existe", brandId: BRAND.scania, value: "W" })).toMatchObject({ ok: false })
  })

  it("lista las pautas con intervalos, ítems, equipos y si tienen reglas por marca", async () => {
    const rows = await listSchedules()
    const main = rows.find((row) => row.id === sourceId)
    expect(main).toMatchObject({ name: "Camiones y tractos", unit: "km", itemCount: 1, hasBrandRules: true })
    expect(main?.intervals).toEqual([10000, 20000, 40000, 60000, 80000])
  })
})

describe("asignación de equipos", () => {
  it("resume lo que se agrega, cambia y deja sin pauta, y escribe el historial de cada equipo", async () => {
    const other = ok(await createSchedule(actor, { name: "Pauta tractos", unit: "km", intervals: [15000], copyFromId: null }))
    // v-3 ya tiene «Pauta tractos»; v-1 y v-2 quedan sin pauta.
    ok(await assignEquipment(actor, { scheduleId: other.data.id, vehicleIds: ["v-3"] }))
    const candidates = (await listAssignCandidates(sourceId))!
    // Sólo activos y de su unidad: v-4 (baja) y v-5 (horas) no entran.
    expect(candidates.candidates.map((item) => item.vehicleId)).toEqual(["v-1", "v-2", "v-3"])
    expect(candidates.candidates.find((item) => item.vehicleId === "v-3")?.scheduleName).toBe("Pauta tractos")

    const result = ok(await assignEquipment(actor, { scheduleId: sourceId, vehicleIds: ["v-1", "v-3", "v-5", "v-4"] }))
    expect(result.data).toEqual({ added: 1, moved: 1, removed: 0 })
    expect(result.message).toBe("1 equipo asignado · 1 equipo cambió de pauta")
    const [p1, p3, p5, p4] = await Promise.all(["v-1", "v-3", "v-5", "v-4"].map(async (id) => (await testDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, id)))[0]))
    expect([p1?.scheduleId, p3?.scheduleId]).toEqual([sourceId, sourceId])
    expect(p5?.scheduleId).toBeNull()
    expect(p4?.scheduleId).toBeNull()
    expect((await listEquipmentHistory("v-3"))[0]).toMatchObject({ action: "schedule_change", summary: "Pauta asignada: «Camiones y tractos» (antes «Pauta tractos»)" })
    expect((await listEquipmentHistory("v-1"))[0]).toMatchObject({ action: "schedule_change", summary: "Pauta asignada: «Camiones y tractos»" })
    // La asignación no cambia la pauta: no sube su versión.
    const versionBefore = (await testDb.select().from(schema.mantSchedules).where(eq(schema.mantSchedules.id, sourceId)))[0]!.version
    ok(await assignEquipment(actor, { scheduleId: sourceId, vehicleIds: ["v-1", "v-3"] }))
    expect((await testDb.select().from(schema.mantSchedules).where(eq(schema.mantSchedules.id, sourceId)))[0]!.version).toBe(versionBefore)
  })

  it("desmarcar un equipo que la tenía lo deja sin pauta", async () => {
    const result = ok(await assignEquipment(actor, { scheduleId: sourceId, vehicleIds: ["v-1"] }))
    expect(result.data).toEqual({ added: 0, moved: 0, removed: 1 })
    expect(result.message).toBe("1 equipo quedó sin pauta")
    expect((await listEquipmentHistory("v-3"))[0]).toMatchObject({ summary: "Pauta quitada: «Camiones y tractos»" })
    expect(ok(await assignEquipment(actor, { scheduleId: sourceId, vehicleIds: ["v-1"] })).message).toBe("Sin cambios en la asignación.")
  })

  it("el editor cuenta los equipos activos por faena", async () => {
    ok(await assignEquipment(actor, { scheduleId: sourceId, vehicleIds: ["v-1", "v-2", "v-3"] }))
    const model = (await loadScheduleEditor(sourceId))!
    expect(model.equipment.total).toBe(3)
    expect(model.equipment.byWorksite).toEqual([
      { worksiteId: WS.arauco, worksiteName: "Arauco", count: 2 },
      { worksiteId: WS.teno, worksiteName: "Teno", count: 1 },
    ])
  })
})

describe("exportar", () => {
  const sessionWith = (permissions: string[], worksiteIds: string[] = [], isGlobal = true) =>
    ({ user: { id: actor.userId, email: actor.email, name: "Jefatura Pautas", permissions, worksiteIds, isGlobal, roles: [] } }) as never
  const session = sessionWith(["mant:records:view_all", "mant:export", "mant:schedules:manage"])

  it("el Excel de pautas trae una hoja por pauta con la matriz y las reglas por marca", async () => {
    const result = await exportSchedules(session, { scheduleIds: [sourceId] })
    expect(result.filename).toMatch(/^pautas-mantencion-camiones-y-tractos_\d{4}-\d{2}-\d{2}\.xlsx$/)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(result.base64, "base64") as never)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Camiones y tractos", "Metadatos"])
    const sheet = workbook.getWorksheet("Camiones y tractos")!
    expect(sheet.getRow(1).values).toEqual([undefined, "Sistema", "Actividad", "10.000 km", "20.000 km", "40.000 km", "60.000 km", "80.000 km", "Nota"])
    expect(sheet.getRow(2).getCell(2).value).toBe("Inspección visual")
    expect(sheet.getRow(4).getCell(1).value).toBe("Reglas por marca")
    expect(sheet.getRow(5).getCell(3).value).toBe("Scania")
    expect(sheet.getRow(6).getCell(3).value).toBe("No aplica")
    expect((await audits("mant_schedule_export")).length).toBe(1)
  })

  it("el Excel de equipos exporta el estado dentro del alcance y registra la auditoría", async () => {
    const result = await exportEquipment(session, { vehicleIds: null, includeRetired: false, filters: { estado: "todos" } })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(result.base64, "base64") as never)
    const sheet = workbook.getWorksheet("Equipos")!
    expect(sheet.rowCount).toBe(1 + result.rowCount)
    expect(result.rowCount).toBe(4) // v-4 está de baja
    expect(sheet.getRow(1).getCell(10).value).toBe("Estado")
    expect((await audits("mant_equipment_export")).length).toBe(1)
  })

  it("el Excel de equipos respeta el alcance de faenas: un id ajeno no sale y sin permisos no sale nada", async () => {
    const scoped = sessionWith(["mant:records:view_worksite", "mant:export"], [WS.arauco], false)
    const own = await exportEquipment(scoped, { vehicleIds: null, includeRetired: false, filters: {} })
    expect(own.rowCount).toBe(2) // KA-1 y KA-2 son de Arauco
    const foreign = await exportEquipment(scoped, { vehicleIds: ["v-3"], includeRetired: false, filters: {} })
    expect(foreign.rowCount).toBe(0)
    const none = await exportEquipment(sessionWith(["mant:export"], [], false), { vehicleIds: null, includeRetired: false, filters: {} })
    expect(none.rowCount).toBe(0)
  })
})

describe("eliminar", () => {
  it("borrado lógico: los equipos quedan sin pauta, con historial, y el nombre queda libre", async () => {
    const before = await listSchedules()
    expect(before.find((row) => row.id === sourceId)?.equipmentCount).toBe(3)
    const result = ok(await deleteSchedule(actor, sourceId))
    expect(result.data.released).toBe(3)
    expect(result.message).toBe("Pauta eliminada. 3 equipos quedaron sin pauta.")
    const [row] = await testDb.select().from(schema.mantSchedules).where(eq(schema.mantSchedules.id, sourceId))
    expect(row?.deletedAt).not.toBeNull()
    expect(row?.deletedBy).toBe(actor.userId)
    for (const id of ["v-1", "v-2", "v-3"]) {
      expect((await testDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, id)))[0]?.scheduleId).toBeNull()
      expect((await listEquipmentHistory(id))[0]).toMatchObject({ action: "schedule_change", summary: "Pauta eliminada: «Camiones y tractos»" })
    }
    expect((await listSchedules()).some((item) => item.id === sourceId)).toBe(false)
    expect(await loadScheduleEditor(sourceId)).toBeNull()
    expect(await renameSchedule(actor, sourceId, "Lo que sea")).toMatchObject({ ok: false })
    // Las versiones se conservan: un registro firmado con la pauta sigue resolviéndose.
    expect(await getScheduleSnapshot(sourceId, 1)).not.toBeNull()
    expect(ok(await createSchedule(actor, { name: "Camiones y tractos", unit: "km", intervals: [10000], copyFromId: null })).ok).toBe(true)
    expect(await deleteSchedule(actor, sourceId)).toMatchObject({ ok: false })
  })
})
