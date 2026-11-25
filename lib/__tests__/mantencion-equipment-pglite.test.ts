import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import ExcelJS from "exceljs"
import { eq, sql } from "drizzle-orm"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { setVehicleWorksiteForTest } from "@/lib/testing/fleet-stays"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

/*
 * Equipos de mantención (§10) contra Postgres de verdad: alta, incorporación de
 * un vehículo que ya estaba en la flota, patente (regla 16), faena nueva
 * normalizada (regla 17), unidad fija con registros, baja y reactivación con su
 * historial, y la importación con vista previa y confirmación.
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
  createEquipment, updateEquipmentPlan, resolveFleetIdentity, applyFleetIdentity, retireEquipment, reactivateEquipment, NEW_WORKSITE,
} = await import("@/lib/services/mantencion/equipment")
type EquipmentInput = import("@/lib/services/mantencion/equipment").EquipmentInput
type FleetIdentityInput = import("@/lib/services/mantencion/equipment").FleetIdentityInput
const { listEquipmentHistory } = await import("@/lib/services/mantencion/equipment-history")
const { setEquipmentUnit } = await import("@/lib/services/mantencion/equipment-unit-change")
const { previewEquipmentImport, commitEquipmentImport, buildEquipmentTemplate, similarName } = await import("@/lib/services/mantencion/equipment-import")

const actor = { userId: "u-jefe-eq", email: "jefe@example.test" }
// `camion` y `tracto` son de la familia camiones: su unidad depende de la faena (Biodiversa, km; las demás, horas).
const T = { km: "t-camion", h: "t-excavadora", none: "t-estanque", camion: "t-camion-prod", tracto: "t-tracto-prod" } as const
const B = { scania: "b-scania", volvo: "b-volvo" } as const
const WS = { arauco: "ws-arauco", cholguan: "ws-cholguan", teno: "ws-teno", bio: "ws-biodiversa" } as const

function input(overrides: Partial<EquipmentInput> = {}): EquipmentInput {
  return {
    code: "KA-500", plate: "BCDF-12", noPlate: false, equipmentTypeId: T.km, brandId: B.scania, model: "R450", year: 2021,
    worksiteId: WS.arauco, newWorksiteName: "", scheduleId: null, initialReading: null, initialReadingDate: null,
    ...overrides,
  }
}

async function profileOf(vehicleId: string) {
  const [row] = await testDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, vehicleId))
  return row
}
async function vehicleByCode(code: string) {
  const rows = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.code, code))
  return rows
}
async function audits(entityType: string, entityId?: string) {
  const rows = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, entityType))
  return entityId ? rows.filter((row) => row.entityId === entityId) : rows
}

async function createdId(result: Awaited<ReturnType<typeof createEquipment>>): Promise<string> {
  if (!result.ok) throw new Error(`Alta fallida: ${result.message}`)
  return result.data.vehicleId
}

let scheduleKm = ""
let scheduleH = ""

/**
 * Lo que hace el padrón al guardar un equipo de Mantención (crítica 2026-11-15, paso 4b):
 * resolver la identidad con las reglas de Mantención, escribir las columnas del vehículo ya
 * resueltas y dejar el rastro en el perfil. El recorrido completo, con la acción del padrón, lo
 * cubre `padron-identidad-mantencion-pglite.test.ts`.
 */
async function editIdentity(vehicleId: string, overrides: Partial<FleetIdentityInput>, canChangeProfile = true) {
  return testDb.transaction(async (tx) => {
    const [vehicle] = await tx.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    if (!vehicle) throw new Error("vehículo de prueba inexistente")
    const identity: FleetIdentityInput = {
      code: vehicle.code ?? "", plate: vehicle.plate, equipmentTypeId: vehicle.equipmentTypeId, model: vehicle.model ?? "",
      year: vehicle.year, worksiteId: vehicle.worksiteId, ...overrides,
    }
    const result = await resolveFleetIdentity(tx, vehicleId, identity, { canChangeProfile })
    if (!result || !result.ok) return result
    const { resolved } = result
    await tx.update(schema.fuelVehicles).set({
      code: resolved.code, plate: resolved.plate, brand: resolved.brand.name, model: resolved.model, year: resolved.year,
      equipmentTypeId: resolved.type.id, type: resolved.type.slug,
    }).where(eq(schema.fuelVehicles.id, vehicleId))
    // La faena no se cambia con un UPDATE directo: la base exige que la estadía abierta la acompañe.
    if (resolved.worksite.id! !== vehicle.worksiteId) await setVehicleWorksiteForTest(tx as unknown as DB, vehicleId, resolved.worksite.id!, todayInChile())
    await applyFleetIdentity(tx, actor, result.current, resolved, "padron")
    return result
  })
}


beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: actor.userId, name: "Jefatura Equipos", email: actor.email, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  // Incorporar a otra faena es un traslado: «Traslados» (apagado por la migración) va encendido.
  await testDb.update(schema.systemSettings).set({ value: "true" }).where(eq(schema.systemSettings.key, "submodule.enabled:flota:/flota/traslados"))
  await testDb.insert(schema.worksites).values([
    { id: WS.arauco, name: "Arauco", code: "FN-ARA", isActive: true },
    { id: WS.cholguan, name: "Cholguan", code: "FN-CHO", isActive: true },
    { id: WS.teno, name: "Teno", code: "FN-TEN", isActive: false },
    { id: WS.bio, name: "Biodiversa", code: "BIODIVERSA", isActive: true },
  ])
  await testDb.insert(schema.fuelEquipmentTypes).values([
    { id: T.km, slug: "test-camion", name: "Camión (prueba)", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" },
    { id: T.h, slug: "test-excavadora", name: "Excavadora (prueba)", category: "heavy", defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour" },
    { id: T.none, slug: "test-estanque", name: "Estanque (prueba)", category: "storage", defaultMeterType: "none", defaultPerformanceUnit: "not_applicable" },
    { id: T.camion, slug: "test-camion-prod", name: "Camión producción (prueba)", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter", performanceFamily: "camiones" },
    { id: T.tracto, slug: "test-tracto-prod", name: "Tractocamión (prueba)", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter", performanceFamily: "camiones" },
  ])
  await testDb.insert(schema.mantBrands).values([
    { id: B.scania, name: "Scania", nameKey: "scania" },
    { id: B.volvo, name: "Volvo", nameKey: "volvo" },
  ])
  // Un vehículo que ya estaba en la flota (sin perfil de mantención) y otro inactivo.
  await testDb.insert(schema.fuelVehicles).values([
    { id: "veh-flota", plate: "GHJK34", code: "KA-300", type: "test-camion", equipmentTypeId: T.km, worksiteId: WS.cholguan, isActive: true },
    { id: "veh-inactivo", plate: "LPRS56", code: "KA-301", type: "test-camion", equipmentTypeId: T.km, worksiteId: WS.cholguan, isActive: false },
  ])
  const { createSchedule } = await import("@/lib/services/mantencion/schedules")
  const km = await createSchedule(actor, { name: "Camiones prueba", unit: "km", intervals: [10000, 20000], copyFromId: null })
  const h = await createSchedule(actor, { name: "Maquinaria prueba", unit: "h", intervals: [300, 600], copyFromId: null })
  if (!km.ok || !h.ok) throw new Error("No se pudieron crear las pautas de prueba")
  scheduleKm = km.data.id
  scheduleH = h.data.id
})

describe("alta", () => {
  it("crea el vehículo y su perfil, copia la marca, deja historial, auditoría y estado operativo", async () => {
    const vehicleId = await createdId(await createEquipment(actor, input({ scheduleId: scheduleKm, initialReading: 12345, initialReadingDate: "2026-10-01" })))
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    expect(vehicle).toMatchObject({ code: "KA-500", plate: "BCDF-12", brand: "Scania", model: "R450", year: 2021, type: "test-camion", meterType: "odometer", isActive: true, worksiteId: WS.arauco })
    expect(await profileOf(vehicleId)).toMatchObject({ brandId: B.scania, scheduleId: scheduleKm, initialReading: 12345, initialReadingDate: "2026-10-01", noPlate: false })
    const history = await listEquipmentHistory(vehicleId)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ action: "create", summary: "Equipo creado", userName: "Jefatura Equipos" })
    expect(await audits("mant_equipment", vehicleId)).toHaveLength(1)
    const intervals = await testDb.select().from(schema.fuelVehicleOperationalIntervals).where(eq(schema.fuelVehicleOperationalIntervals.vehicleId, vehicleId))
    expect(intervals).toHaveLength(1)
  })

  it("normaliza el código y no repite un código aunque se escriba distinto", async () => {
    const dup = await createEquipment(actor, input({ code: " ka-500 ", plate: "TVWX-12" }))
    expect(dup).toMatchObject({ ok: false, fieldErrors: { code: "Ya existe un equipo con el código KA-500." } })
  })

  it("el índice único del código atrapa lo que el pre-chequeo no ve («KA-0500» = «KA-500») y dice «Ya existe un equipo con el código»", async () => {
    const dup = await createEquipment(actor, input({ code: "KA-0500", plate: "TVWX-13" }))
    expect(dup).toMatchObject({ ok: false, fieldErrors: { code: "Ya existe un equipo con el código KA-0500." } })
  })

  it("rechaza la patente repetida y la inválida, y cuenta cada error por campo", async () => {
    const repeated = await createEquipment(actor, input({ code: "KA-501", plate: "bcdf 12" }))
    expect(repeated).toMatchObject({ ok: false })
    expect(!repeated.ok && repeated.fieldErrors.plate).toMatch(/ya está en el equipo KA-500/)

    const invalid = await createEquipment(actor, input({ code: "KA-502", plate: "ABC-123", brandId: "", equipmentTypeId: "" }))
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) {
      expect(invalid.fieldErrors.plate).toMatch(/no es una patente válida/)
      expect(invalid.fieldErrors.brandId).toBe("Elige la marca de la lista.")
      expect(invalid.fieldErrors.equipmentTypeId).toBe("Elige el tipo de equipo.")
    }
    expect(await vehicleByCode("KA-502")).toHaveLength(0)
  })

  it("«Sin patente» guarda el código como patente y la ficha lo recuerda", async () => {
    const vehicleId = await createdId(await createEquipment(actor, input({ code: "TO-37", plate: "", noPlate: true })))
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    expect(vehicle?.plate).toBe("TO-37")
    expect((await profileOf(vehicleId))?.noPlate).toBe(true)
  })

  it("incorpora un vehículo que ya estaba en la flota sin duplicarlo", async () => {
    const before = (await testDb.select().from(schema.fuelVehicles)).length
    const result = await createEquipment(actor, input({ code: "KA-300", plate: "GHJK-34", model: "FH 460", brandId: B.volvo, worksiteId: WS.arauco }))
    expect(result).toMatchObject({ ok: true, data: { vehicleId: "veh-flota", incorporated: true } })
    expect((await testDb.select().from(schema.fuelVehicles)).length).toBe(before)
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, "veh-flota"))
    expect(vehicle).toMatchObject({ plate: "GHJK-34", brand: "Volvo", model: "FH 460", worksiteId: WS.arauco })
    // Incorporarlo a otra faena es un traslado (la faena sólo cambia por esa puerta): con folio, hoy y su motivo.
    const transfers = await testDb.select().from(schema.fleetTransfers)
    expect(transfers).toEqual([expect.objectContaining({
      folio: "TR-0001", toWorksiteId: WS.arauco, effectiveDate: todayInChile(),
      reason: "Incorporación a Mantención de equipos", authorizedBy: "Jefatura Equipos", createdBy: actor.userId,
    })])
    const stays = await testDb.select().from(schema.fuelVehicleWorksiteIntervals)
      .where(eq(schema.fuelVehicleWorksiteIntervals.vehicleId, "veh-flota"))
    expect(stays.map((stay) => [stay.worksiteId, stay.source]).sort()).toEqual([[WS.arauco, "traslado"], [WS.cholguan, "alta"]])
    expect(stays.find((stay) => stay.worksiteId === WS.arauco)).toMatchObject({ startedOn: todayInChile(), endedOn: null, transferId: transfers[0]!.id })
    expect(await profileOf("veh-flota")).toMatchObject({ brandId: B.volvo })
    const [entry] = await listEquipmentHistory("veh-flota")
    expect(entry?.summary).toMatch(/incorporado a la mantención desde la flota/)
    // Una vez incorporado, el mismo código ya es un duplicado.
    expect(await createEquipment(actor, input({ code: "KA-300", plate: "GHJK-34" }))).toMatchObject({ ok: false })
  })

  it("no incorpora un vehículo inactivo de la flota y avisa qué hacer", async () => {
    const result = await createEquipment(actor, input({ code: "KA-301", plate: "LPRS-56" }))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.fieldErrors.code).toMatch(/inactivo en la flota/)
  })

  it("filtra la pauta por unidad y exige un tipo con medidor", async () => {
    const wrongUnit = await createEquipment(actor, input({ code: "KA-503", plate: "WXYZ-12", scheduleId: scheduleH }))
    expect(!wrongUnit.ok && wrongUnit.fieldErrors.scheduleId).toMatch(/se mide en horas y el equipo en kilómetros/)
    const noMeter = await createEquipment(actor, input({ code: "ES-1", plate: "", noPlate: true, equipmentTypeId: T.none }))
    expect(!noMeter.ok && noMeter.fieldErrors.equipmentTypeId).toMatch(/no se mide en kilómetros ni en horas/)
  })

  it("el equipo sólo se asigna a una faena que ya existe: «Nueva faena…» se rechaza aunque el nombre coincida con una existente", async () => {
    const before = (await testDb.select().from(schema.worksites)).length
    for (const typed of ["  cholguán ", "Flor del Laja", "teno"]) {
      const result = await createEquipment(actor, input({ code: "KA-504", plate: "HJKL-12", worksiteId: NEW_WORKSITE, newWorksiteName: typed }))
      expect(!result.ok && result.fieldErrors.worksiteId).toMatch(/No puedes crear faenas nuevas desde un equipo/)
    }
    // No quedó ni el equipo ni ninguna faena nueva.
    expect((await testDb.select().from(schema.worksites)).length).toBe(before)
    expect(await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.code, "KA-504"))).toHaveLength(0)
  })

  it("editar la identidad desde el padrón tampoco crea faenas", async () => {
    const vehicleId = await createdId(await createEquipment(actor, input({ code: "KA-505", plate: "KLPR-12" })))
    const before = (await testDb.select().from(schema.worksites)).length
    const result = await editIdentity(vehicleId, { worksiteId: NEW_WORKSITE })
    expect(result && !result.ok && result.fieldErrors.worksiteId).toMatch(/No puedes crear faenas nuevas desde un equipo/)
    expect((await testDb.select().from(schema.worksites)).length).toBe(before)
  })
})

describe("identidad desde el padrón (crítica 2026-11-15, paso 4b)", () => {
  let vehicleId = ""
  it("registra los cambios con etiquetas en español y una sola fila de historial, dicha como del padrón", async () => {
    vehicleId = await createdId(await createEquipment(actor, input({ code: "KA-600", plate: "RSTV-12", scheduleId: scheduleKm })))
    const result = await editIdentity(vehicleId, { model: "R500", year: 2022, worksiteId: WS.cholguan })
    expect(result?.ok).toBe(true)
    const [latest] = await listEquipmentHistory(vehicleId)
    expect(latest?.action).toBe("update")
    expect(latest?.summary).toMatch(/^Editado en Vehículos · /)
    expect(latest?.summary).toContain("Modelo: R450 → R500")
    expect(latest?.summary).toContain("Faena: Arauco → Cholguan")
    // jsonb no conserva el orden de las llaves: se compara el conjunto.
    expect(Object.keys(latest?.changes ?? {}).sort()).toEqual(["Año", "Faena", "Modelo"])
    // La pauta y la lectura inicial no las toca el padrón.
    expect(await profileOf(vehicleId)).toMatchObject({ scheduleId: scheduleKm, brandId: B.scania })
    // Sin cambios no escribe nada.
    await editIdentity(vehicleId, {})
    expect(await listEquipmentHistory(vehicleId)).toHaveLength(2)
  })

  it("normaliza como el alta: la patente con guion y el código en mayúsculas", async () => {
    const result = await editIdentity(vehicleId, { code: " ka-600 ", plate: "rstv 12" })
    expect(result?.ok && result.resolved).toMatchObject({ code: "KA-600", plate: "RSTV-12" })
    expect(await listEquipmentHistory(vehicleId)).toHaveLength(2)
  })

  it("la marca y «Sin patente» son del perfil: sin permiso de Mantención se conservan; con él, se cambian con historial", async () => {
    const kept = await editIdentity(vehicleId, { brandId: B.volvo, noPlate: true }, false)
    expect(kept?.ok && kept.resolved).toMatchObject({ brand: { id: B.scania }, noPlate: false, plate: "RSTV-12" })
    expect(await profileOf(vehicleId)).toMatchObject({ brandId: B.scania, noPlate: false })

    const changed = await editIdentity(vehicleId, { brandId: B.volvo }, true)
    expect(changed?.ok).toBe(true)
    expect(await profileOf(vehicleId)).toMatchObject({ brandId: B.volvo })
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    expect(vehicle?.brand).toBe("Volvo")
    const [latest] = await listEquipmentHistory(vehicleId)
    expect(latest?.summary).toContain("Marca: Scania → Volvo")
  })

  it("la marca desactivada que ya tiene se conserva: quien corrige otra cosa no queda trabado", async () => {
    await testDb.update(schema.mantBrands).set({ isActive: false }).where(eq(schema.mantBrands.id, B.volvo))
    try {
      expect((await editIdentity(vehicleId, { model: "R510" }, false))?.ok).toBe(true)
      // Elegirla de nuevo para otro equipo sí se rechaza.
      const other = await createdId(await createEquipment(actor, input({ code: "KA-602", plate: "TVWX-34" })))
      const rejected = await editIdentity(other, { brandId: B.volvo }, true)
      expect(rejected && !rejected.ok && rejected.fieldErrors.brandId).toBe("Esa marca no está en la lista.")
    } finally {
      await testDb.update(schema.mantBrands).set({ isActive: true }).where(eq(schema.mantBrands.id, B.volvo))
    }
  })

  it("un tipo que no se mide en km ni en horas no se acepta", async () => {
    const result = await editIdentity(vehicleId, { equipmentTypeId: T.none })
    expect(result && !result.ok && result.fieldErrors.equipmentTypeId).toMatch(/no se mide en kilómetros ni en horas/)
  })

  it("con una pauta asignada, el tipo de otra unidad dice dónde quitarla", async () => {
    const free = await createdId(await createEquipment(actor, input({ code: "KA-603", plate: "VWXY-56", scheduleId: scheduleKm })))
    const result = await editIdentity(free, { equipmentTypeId: T.h })
    expect(result && !result.ok && result.fieldErrors.equipmentTypeId).toMatch(/Tiene la pauta «Camiones prueba».*pestaña Mantención/)
    expect(result && !result.ok && result.fieldErrors).not.toHaveProperty("scheduleId")
  })

  it("no deja cambiar el tipo a otra unidad cuando el equipo ya tiene registros", async () => {
    await testDb.insert(schema.mantRecords).values({
      id: "rec-eq-1", kind: "C", vehicleId, equipmentSnapshot: { code: "KA-600", plate: "RSTV-12", noPlate: false, type: "Camión", brand: "Scania", model: null, year: null, worksite: "Cholguan", unit: "km" },
      worksiteId: WS.cholguan, reading: 5000, unit: "km", workDate: "2026-10-10", registeredBy: actor.userId, executorKind: "yo", executorUserId: actor.userId,
      executorName: "Jefatura Equipos", signedAt: "2026-10-10T12:00:00.000Z",
    })
    const blocked = await editIdentity(vehicleId, { equipmentTypeId: T.h })
    expect(blocked && !blocked.ok && blocked.fieldErrors.equipmentTypeId).toBe("No se puede cambiar a otra unidad: el equipo ya tiene registros.")
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    expect(vehicle?.equipmentTypeId).toBe(T.km)
  })

  it("permite cambiar el tipo a otra unidad mientras no tenga registros ni pauta", async () => {
    const free = await createdId(await createEquipment(actor, input({ code: "KA-601", plate: "STVW-12" })))
    const changed = await editIdentity(free, { equipmentTypeId: T.h })
    expect(changed?.ok && changed.resolved.type).toMatchObject({ id: T.h, unit: "h" })
  })

  it("un vehículo que no está en Mantención no se resuelve aquí: el padrón sigue con sus reglas", async () => {
    expect(await editIdentity("veh-inactivo", { model: "Lo que sea" })).toBeNull()
  })
})

describe("«Editar mantención»: pauta, lectura inicial y baja", () => {
  let vehicleId = ""
  const plan = (overrides: Partial<{ scheduleId: string | null; initialReading: number | null; initialReadingDate: string | null }> = {}) => ({
    scheduleId: scheduleKm, initialReading: null, initialReadingDate: null, ...overrides,
  })
  const active = { active: true, retiredReason: "" }

  it("cambiar sólo la pauta queda como schedule_change; sin cambios no escribe nada", async () => {
    vehicleId = await createdId(await createEquipment(actor, input({ code: "KA-610", plate: "WXYZ-12", scheduleId: scheduleKm })))
    expect(await updateEquipmentPlan(actor, vehicleId, plan(), active)).toMatchObject({ ok: true, data: { changed: false } })
    await updateEquipmentPlan(actor, vehicleId, plan({ scheduleId: null }), active)
    const [latest] = await listEquipmentHistory(vehicleId)
    expect(latest).toMatchObject({ action: "schedule_change", summary: "Pauta quitada: «Camiones prueba»" })
    expect(await profileOf(vehicleId)).toMatchObject({ scheduleId: null })
  })

  it("no ofrece pautas de otra unidad", async () => {
    const result = await updateEquipmentPlan(actor, vehicleId, plan({ scheduleId: scheduleH }), active)
    expect(!result.ok && result.fieldErrors.scheduleId).toBe("Esa pauta se mide en horas y el equipo en kilómetros.")
  })

  it("la lectura inicial se fija sin registros y queda fija con ellos", async () => {
    const set = await updateEquipmentPlan(actor, vehicleId, plan({ scheduleId: null, initialReading: 4_000, initialReadingDate: "2026-10-01" }), active)
    expect(set.ok).toBe(true)
    expect((await listEquipmentHistory(vehicleId))[0]?.action).toBe("initial_reading")
    await testDb.insert(schema.mantRecords).values({
      id: "rec-eq-2", kind: "C", vehicleId, equipmentSnapshot: { code: "KA-610", plate: "WXYZ-12", noPlate: false, type: "Camión", brand: "Scania", model: null, year: null, worksite: "Arauco", unit: "km" },
      worksiteId: WS.arauco, reading: 5000, unit: "km", workDate: "2026-10-10", registeredBy: actor.userId, executorKind: "yo", executorUserId: actor.userId,
      executorName: "Jefatura Equipos", signedAt: "2026-10-10T12:00:00.000Z",
    })
    const locked = await updateEquipmentPlan(actor, vehicleId, plan({ scheduleId: null, initialReading: 100, initialReadingDate: "2026-10-01" }), active)
    expect(!locked.ok && locked.fieldErrors.initialReading).toMatch(/ya tiene registros/)
  })

  it("da de baja con motivo y reactiva, con historial y auditoría de cada paso", async () => {
    const short = await retireEquipment(actor, vehicleId, "corto")
    expect(short.ok).toBe(false)
    const retired = await retireEquipment(actor, vehicleId, "Equipo vendido a tercero")
    expect(retired.ok).toBe(true)
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    expect(vehicle?.isActive).toBe(false)
    expect((await profileOf(vehicleId))?.retiredReason).toBe("Equipo vendido a tercero")
    expect((await retireEquipment(actor, vehicleId, "Equipo vendido a tercero")).ok).toBe(false)

    const back = await reactivateEquipment(actor, vehicleId)
    expect(back.ok).toBe(true)
    expect((await profileOf(vehicleId))?.retiredReason).toBeNull()
    const actions = (await listEquipmentHistory(vehicleId)).map((entry) => entry.action)
    expect(actions.slice(0, 2)).toEqual(["reactivate", "retire"])
    const statusAudits = (await audits("mant_equipment", vehicleId)).filter((row) => row.action === "status_change")
    expect(statusAudits).toHaveLength(2)
  })

  it("la baja desde «Editar mantención» es atómica: sin motivo no cambia nada", async () => {
    const result = await updateEquipmentPlan(actor, vehicleId, plan({ scheduleId: scheduleKm, initialReading: 4_000, initialReadingDate: "2026-10-01" }), { active: false, retiredReason: "" })
    expect(!result.ok && result.fieldErrors.retiredReason).toBeTruthy()
    expect(await profileOf(vehicleId)).toMatchObject({ scheduleId: null })
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    expect(vehicle?.isActive).toBe(true)
  })

  it("con motivo da de baja y cambia la pauta en una sola operación", async () => {
    const result = await updateEquipmentPlan(actor, vehicleId, plan({ scheduleId: scheduleKm, initialReading: 4_000, initialReadingDate: "2026-10-01" }), { active: false, retiredReason: "Equipo vendido a tercero" })
    expect(result).toMatchObject({ ok: true, data: { changed: true } })
    expect(await profileOf(vehicleId)).toMatchObject({ scheduleId: scheduleKm, retiredReason: "Equipo vendido a tercero" })
  })
})

async function workbookBuffer(rows: Array<Array<string | number | null>>): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Equipos")
  sheet.addRow(["Código", "Patente", "Tipo de equipo", "Marca", "Modelo", "Año", "Faena", "Pauta", "Lectura inicial", "Fecha de la lectura"])
  for (const row of rows) sheet.addRow(row)
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

describe("importación", () => {
  const ROWS: Array<Array<string | number | null>> = [
    ["IM-1", "BCDG-12", "Camión (prueba)", "Scania", "P360", 2020, "Arauco", "Camiones prueba", 40312, "01-10-2026"],
    ["IM-2", "Sin patente", "Excavadora (prueba)", "Volvo", null, null, "Faena Importada", "Maquinaria prueba", "5.400", null],
    ["KA-500", null, null, null, "R450 NUEVO", null, null, null, null, null], // existente: sólo cambia el modelo
    ["KA-600", null, null, null, null, null, null, null, null, null], // existente sin cambios
    ["IM-3", "XXX-999", "Camión (prueba)", "Marca X", null, null, "Arauco", null, null, null], // patente y marca inválidas
    ["IM-1", "EFGH-12", "Camión (prueba)", "Scania", null, null, "Arauco", null, null, null], // código repetido en el archivo
    ["IM-4", "JKLP-12", "Camión (prueba)", "Scania", null, null, "Arauco", "Maquinaria prueba", null, null], // pauta en otra unidad
  ]

  it("la vista previa clasifica cada fila y no escribe nada", async () => {
    const before = (await testDb.select().from(schema.fuelVehicles)).length
    const preview = await previewEquipmentImport(await workbookBuffer(ROWS))
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const kinds = Object.fromEntries(preview.data.rows.map((row) => [row.row, row.kind]))
    expect(kinds).toEqual({ 2: "create", 3: "create", 4: "update", 5: "unchanged", 6: "error", 7: "error", 8: "error" })
    expect(preview.data.summary).toMatchObject({ created: 2, updated: 1, unchanged: 1, errors: 3, newWorksites: ["Faena Importada"] })
    const errorRow = preview.data.rows.find((row) => row.row === 6)
    expect(errorRow?.messages.join(" ")).toMatch(/patente válida/)
    // «Marca X» ya no es error en la vista previa de la jefatura: se anunciaría como marca nueva (B2).
    expect(preview.data.rows.find((row) => row.row === 7)?.messages[0]).toMatch(/ya aparece en la fila 2/)
    expect(preview.data.rows.find((row) => row.row === 8)?.messages.join(" ")).toMatch(/se mide en horas/)
    const updateRow = preview.data.rows.find((row) => row.row === 4)
    expect(updateRow?.messages).toHaveLength(1)
    expect(updateRow?.messages[0]).toContain("Modelo:")
    expect((await testDb.select().from(schema.fuelVehicles)).length).toBe(before)
    expect(await testDb.select().from(schema.worksites).where(eq(schema.worksites.name, "Faena Importada"))).toHaveLength(0)
  })

  it("al confirmar escribe sólo las filas válidas, con historial «import» y una auditoría", async () => {
    // La faena nueva sólo se crea con la casilla «Crear estas faenas» (A3).
    const result = await commitEquipmentImport(actor, await workbookBuffer(ROWS), "equipos.xlsx", { allowNewWorksites: true })
    expect(result).toMatchObject({ ok: true, data: { created: 2, updated: 1, unchanged: 1, errors: 3, newWorksites: ["Faena Importada"] } })

    const [im1] = await vehicleByCode("IM-1")
    expect(im1).toMatchObject({ plate: "BCDG-12", brand: "Scania", model: "P360" })
    expect(await profileOf(im1!.id)).toMatchObject({ initialReading: 40312, initialReadingDate: "2026-10-01", scheduleId: scheduleKm })
    const [im2] = await vehicleByCode("IM-2")
    expect(im2?.plate).toBe("IM-2")
    expect(await profileOf(im2!.id)).toMatchObject({ noPlate: true, initialReading: 5400, scheduleId: scheduleH })
    const [site] = await testDb.select().from(schema.worksites).where(eq(schema.worksites.id, im2!.worksiteId))
    expect(site?.name).toBe("Faena Importada")
    expect(await vehicleByCode("IM-3")).toHaveLength(0)
    expect(await vehicleByCode("IM-4")).toHaveLength(0)

    const [ka500] = await vehicleByCode("KA-500")
    expect(ka500?.model).toBe("R450 NUEVO")
    expect((await listEquipmentHistory(ka500!.id))[0]).toMatchObject({ action: "import" })
    expect((await listEquipmentHistory(im1!.id))[0]).toMatchObject({ action: "import" })
    const importAudits = await audits("mant_equipment_import")
    expect(importAudits).toHaveLength(1)
    expect(JSON.parse(String(importAudits[0]?.newState))).toMatchObject({ fileName: "equipos.xlsx", created: 2, updated: 1 })

    // Repetir la misma planilla ya no crea nada: lo creado ahora es «sin cambios».
    const again = await previewEquipmentImport(await workbookBuffer(ROWS.slice(0, 2)))
    expect(again.ok && again.data.summary).toMatchObject({ created: 0, unchanged: 2 })
  })

  // ── Planilla real (2026-11-11): avisos, faenas y marcas nuevas con confirmación ──

  it("un tipo sin medidor sale «No aplica» y no bloquea la importación", async () => {
    const preview = await previewEquipmentImport(await workbookBuffer([["ES-9", "Sin patente", "Estanque (prueba)", "Scania", null, null, "Arauco", null, null, null]]))
    expect(preview.ok && preview.data.rows[0]).toMatchObject({ kind: "skipped", messages: [expect.stringMatching(/No aplica/)] })
    expect(preview.ok && preview.data.summary).toMatchObject({ skipped: 1, errors: 0 })
  })

  it("una lectura inicial distinta en un equipo con registros se conserva con aviso, sin perder la fila", async () => {
    const preview = await previewEquipmentImport(await workbookBuffer([["KA-600", null, null, null, null, null, null, null, 999_999, "01-10-2026"]]))
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.data.rows[0]?.kind).not.toBe("error")
    expect(preview.data.rows[0]?.notices?.[0]).toMatch(/se conserva la actual/i)
  })

  it("una faena nueva exige la casilla; «Sin ubicación» nunca se crea", async () => {
    const rows: Array<Array<string | number | null>> = [
      ["IM-20", "GHJK-20", "Camión (prueba)", "Scania", null, null, "Faena Sin Casilla", null, null, null],
      ["IM-21", "GHJK-21", "Camión (prueba)", "Scania", null, null, "Sin ubicación", null, null, null],
    ]
    const preview = await previewEquipmentImport(await workbookBuffer(rows))
    expect(preview.ok && preview.data.summary.newWorksites).toEqual(["Faena Sin Casilla"])
    expect(preview.ok && preview.data.rows[1]?.messages[0]).toMatch(/no es una faena/)
    const sinCasilla = await commitEquipmentImport(actor, await workbookBuffer(rows), "equipos.xlsx")
    expect(sinCasilla).toMatchObject({ ok: true, data: { created: 0, errors: 2 } })
    expect(await testDb.select().from(schema.worksites).where(eq(schema.worksites.name, "Faena Sin Casilla"))).toHaveLength(0)
  })

  it("una marca nueva se anuncia, y sólo se crea con su casilla", async () => {
    const rows: Array<Array<string | number | null>> = [["IM-30", "GHJK-30", "Camión (prueba)", "Rocongu", null, null, "Arauco", null, null, null]]
    const preview = await previewEquipmentImport(await workbookBuffer(rows))
    expect(preview.ok && preview.data.summary).toMatchObject({ newBrands: ["Rocongu"], created: 1, errors: 0 })
    const sinCasilla = await commitEquipmentImport(actor, await workbookBuffer(rows), "equipos.xlsx")
    expect(sinCasilla).toMatchObject({ ok: true, data: { created: 0, errors: 1 } })
    const conCasilla = await commitEquipmentImport(actor, await workbookBuffer(rows), "equipos.xlsx", { allowNewBrands: true })
    expect(conCasilla).toMatchObject({ ok: true, data: { created: 1, newBrands: ["Rocongu"] } })
    const [brand] = await testDb.select().from(schema.mantBrands).where(eq(schema.mantBrands.name, "Rocongu"))
    expect(brand).toBeDefined()
    expect(await profileOf((await vehicleByCode("IM-30"))[0]!.id)).toMatchObject({ brandId: brand!.id })
  })

  it("sugiere la marca existente parecida antes de crear un duplicado", () => {
    const existing = ["Mercedes", "Ford Cargo", "Sinotruk", "Scania", "MAN"]
    expect(similarName("Mercedes Benz", existing)).toBe("Mercedes")
    expect(similarName("Ford", existing)).toBe("Ford Cargo")
    expect(similarName("Sinotruck", existing)).toBe("Sinotruk")
    expect(similarName("Rocongu", existing)).toBeNull()
    expect(similarName("Mazda", existing)).toBeNull()
  })

  it("quien no ve todas las faenas no crea marcas: la fila queda con error", async () => {
    const encargado = { ...actor, scope: [WS.arauco] }
    const rows: Array<Array<string | number | null>> = [["IM-31", "GHJK-31", "Camión (prueba)", "Tremac", null, null, "Arauco", null, null, null]]
    const result = await commitEquipmentImport(encargado, await workbookBuffer(rows), "equipos.xlsx", { allowNewBrands: true })
    expect(result).toMatchObject({ ok: true, data: { created: 0, errors: 1 } })
  })

  it("rechaza un archivo que no es Excel y una planilla sin columna de código", async () => {
    const notExcel = await previewEquipmentImport(new TextEncoder().encode("a,b,c").buffer as ArrayBuffer)
    expect(notExcel).toMatchObject({ ok: false })
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet("Equipos").addRow(["Patente", "Marca"])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const noCode = await previewEquipmentImport(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
    expect(!noCode.ok && noCode.message).toMatch(/columna «Código»/)
  })

  it("la plantilla es un Excel con la hoja Equipos y las listas vigentes", async () => {
    const template = await buildEquipmentTemplate()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(template.base64, "base64") as never)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Equipos", "Listas", "Instrucciones"])
    expect(workbook.getWorksheet("Equipos")?.getRow(1).getCell(1).value).toBe("Código")
    const lists = workbook.getWorksheet("Listas")!
    const brands = lists.getColumn(3).values.filter(Boolean)
    expect(brands).toContain("Scania")
  })
})

// La sincronización Copec atribuye el consumo por la faena de la asignación de
// proveedor, no por la del vehículo: cambiar la faena desde la mantención
// tiene que llevar sus asignaciones.
describe("las asignaciones de proveedor siguen al equipo cuando cambia de faena", () => {
  async function mapPlate(vehicleId: string, plateKey: string, worksiteId: string) {
    await testDb.insert(schema.fuelProviderMappings).values({
      id: `map-${plateKey}`, provider: "copec", sourceAccount: "tct:diesel", externalKey: plateKey, normalizedValue: plateKey,
      worksiteId, vehicleId, decidedBy: actor.userId, reason: "prueba", effectiveFrom: "2026-01-01",
    })
  }
  async function activeMapping(plateKey: string) {
    const rows = await testDb.select().from(schema.fuelProviderMappings).where(eq(schema.fuelProviderMappings.externalKey, plateKey))
    return { active: rows.filter((row) => row.isActive), closed: rows.filter((row) => !row.isActive) }
  }

  it("al incorporar un vehículo de la flota en otra faena", async () => {
    await testDb.insert(schema.fuelVehicles).values({ id: "veh-flota-map", plate: "DFGH56", code: "KA-310", type: "test-camion", equipmentTypeId: T.km, worksiteId: WS.cholguan, isActive: true })
    await mapPlate("veh-flota-map", "DFGH56", WS.cholguan)
    await createdId(await createEquipment(actor, input({ code: "KA-310", plate: "DFGH-56", worksiteId: WS.arauco })))
    const { active, closed } = await activeMapping("DFGH56")
    // La asignación se mueve con el traslado: la nueva rige desde el día del traslado.
    expect(active).toEqual([expect.objectContaining({ worksiteId: WS.arauco, vehicleId: "veh-flota-map", version: 2, effectiveFrom: todayInChile() })])
    expect(closed).toEqual([expect.objectContaining({ worksiteId: WS.cholguan, version: 1 })])
  })

  // Contratos por faena: el contrato de un equipo es de la faena donde está. Incorporar a Mantención un
  // vehículo de la flota en otra faena lo traslada (applyCreate → transferVehiclesTx), y el traslado
  // cierra el contrato de la faena que deja.
  it("mover un equipo de faena al incorporarlo cierra su asignación de contrato", async () => {
    const vehicleId = "veh-flota-ctr"
    await testDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: "DFGH57", code: "KA-712", type: "test-camion", equipmentTypeId: T.km, worksiteId: WS.cholguan, isActive: true })
    await testDb.insert(schema.clients).values({ id: "cl-ctr", rut: "76123456-0", name: "Maderas Arauco S.A." })
    await testDb.insert(schema.contracts).values({ id: "c-ctr", code: "CTR-2026-0001", clientId: "cl-ctr", name: "Movimiento de residuos", worksiteId: WS.cholguan, billingCycle: "none" })
    await testDb.insert(schema.contractVehicleAssignments).values({ id: "a-ctr", contractId: "c-ctr", vehicleId, validFrom: "2020-01-01" })

    await createdId(await createEquipment(actor, input({ code: "KA-712", plate: "DFGH-57", worksiteId: WS.arauco })))

    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    expect(vehicle?.worksiteId).toBe(WS.arauco)
    const [assignment] = await testDb.select().from(schema.contractVehicleAssignments).where(eq(schema.contractVehicleAssignments.id, "a-ctr"))
    expect(assignment?.validTo).toBe(addDaysToPlainDate(todayInChile(), -1))
  })
})

// EQN-1 (auditoría de Mantención 2026-11-22): con registros y sin lectura inicial la lectura queda fija
// en nulo, y la preventiva declarada pedía una lectura inicial imposible de cargar. Sólo los registros
// vigentes fijan la lectura; la declarada se valida contra el primer registro vigente.
describe("EQN-1: preventiva declarada en un equipo con registros y sin lectura inicial", () => {
  const active = { active: true, retiredReason: "" }
  const prior = { date: "2026-08-20", reading: 4_000, intervalValue: 10_000, evidence: "OT 35513", declaredBy: actor.userId, source: "Editar mantención" }
  const plan = (priorPreventive?: typeof prior | null) => ({ scheduleId: scheduleKm, initialReading: null, initialReadingDate: null, priorPreventive })

  async function addRecord(vehicleId: string, id: string, workDate: string, reading: number, status: "vigente" | "anulado", receivedAt?: string) {
    await testDb.insert(schema.mantRecords).values({
      id, kind: "C", vehicleId, equipmentSnapshot: { code: "KA-7xx", plate: "AAAA-00", noPlate: false, type: "Camión", brand: "Scania", model: null, year: null, worksite: "Arauco", unit: "km" },
      worksiteId: WS.arauco, reading, unit: "km", workDate, registeredBy: actor.userId, executorKind: "yo", executorUserId: actor.userId,
      executorName: "Jefatura Equipos", signedAt: `${workDate}T12:00:00.000Z`, status, ...(receivedAt ? { receivedAt } : {}),
    })
  }
  async function equipmentWithRecords(code: string, plate: string, records: Array<[string, string, number, "vigente" | "anulado", string?]>) {
    const vehicleId = await createdId(await createEquipment(actor, input({ code, plate, scheduleId: scheduleKm })))
    for (const [id, workDate, reading, status, receivedAt] of records) await addRecord(vehicleId, id, workDate, reading, status, receivedAt)
    return vehicleId
  }

  it("se carga: la declarada se valida contra el primer registro vigente, sin lectura inicial", async () => {
    const vehicleId = await equipmentWithRecords("KA-701", "BCDF-81", [["rec-eqn-1", "2026-10-10", 5_000, "vigente"]])
    const saved = await updateEquipmentPlan(actor, vehicleId, plan(prior), active)
    expect(saved).toMatchObject({ ok: true, data: { changed: true } })
    expect(await profileOf(vehicleId)).toMatchObject({ initialReading: null, priorPreventiveDate: "2026-08-20", priorPreventiveReading: 4_000, priorPreventiveInterval: 10_000 })
    // Editar otra cosa después no lo trata como «quitar la lectura inicial».
    expect(await updateEquipmentPlan(actor, vehicleId, { ...plan(prior), scheduleId: null, priorPreventive: undefined }, active)).toMatchObject({ ok: true })
  })

  it("rechaza fecha o lectura posteriores al primer registro, con fechas y lecturas legibles", async () => {
    const vehicleId = await equipmentWithRecords("KA-702", "BCDF-82", [["rec-eqn-2", "2026-10-10", 5_000, "vigente"]])
    const result = await updateEquipmentPlan(actor, vehicleId, plan({ ...prior, date: "2026-10-11", reading: 5_001 }), active)
    expect(!result.ok && result.fieldErrors.priorPreventiveDate).toBe("La fecha de la preventiva no puede ser posterior a la del primer registro del equipo (10-10-2026).")
    expect(!result.ok && result.fieldErrors.priorPreventiveReading).toBe("La lectura de la preventiva no puede ser mayor que la del primer registro del equipo (5.000 km).")
    expect((await profileOf(vehicleId))?.priorPreventiveDate).toBeNull()
  })

  it("el primer registro vigente es el de menor fecha de trabajo; los anulados no cuentan", async () => {
    const vehicleId = await equipmentWithRecords("KA-703", "BCDF-83", [
      ["rec-eqn-3a", "2026-09-01", 3_000, "anulado"],
      ["rec-eqn-3b", "2026-10-10", 5_000, "vigente"],
      ["rec-eqn-3c", "2026-10-05", 4_500, "vigente"],
    ])
    const late = await updateEquipmentPlan(actor, vehicleId, plan({ ...prior, date: "2026-10-06", reading: 4_400 }), active)
    expect(!late.ok && late.fieldErrors.priorPreventiveDate).toContain("05-10-2026")
    const fine = await updateEquipmentPlan(actor, vehicleId, plan({ ...prior, date: "2026-10-05", reading: 4_500 }), active)
    expect(fine.ok).toBe(true)
  })

  it("con el mismo día de trabajo manda la recepción más antigua", async () => {
    const vehicleId = await equipmentWithRecords("KA-704", "BCDF-84", [
      ["rec-eqn-4a", "2026-10-10", 5_000, "vigente", "2026-10-12T10:00:00.000Z"],
      ["rec-eqn-4b", "2026-10-10", 4_800, "vigente", "2026-10-10T10:00:00.000Z"],
    ])
    const result = await updateEquipmentPlan(actor, vehicleId, plan({ ...prior, reading: 4_900 }), active)
    expect(!result.ok && result.fieldErrors.priorPreventiveReading).toContain("4.800 km")
  })

  it("sin lectura inicial y sin registros vigentes se sigue pidiendo la lectura inicial", async () => {
    const vehicleId = await equipmentWithRecords("KA-705", "BCDF-85", [["rec-eqn-5", "2026-10-10", 5_000, "anulado"]])
    const result = await updateEquipmentPlan(actor, vehicleId, plan(prior), active)
    expect(!result.ok && result.fieldErrors.priorPreventiveDate).toMatch(/Primero indica la lectura inicial/)
  })

  it("con sólo registros anulados la lectura inicial se puede fijar, pero la unidad sigue fija", async () => {
    const vehicleId = await equipmentWithRecords("KA-706", "BCDF-86", [["rec-eqn-6", "2026-10-10", 5_000, "anulado"]])
    const set = await updateEquipmentPlan(actor, vehicleId, { scheduleId: scheduleKm, initialReading: 6_000, initialReadingDate: "2026-10-20" }, active)
    expect(set.ok).toBe(true)
    expect(await profileOf(vehicleId)).toMatchObject({ initialReading: 6_000 })
    const blocked = await editIdentity(vehicleId, { equipmentTypeId: T.h })
    expect(blocked && !blocked.ok && blocked.fieldErrors.equipmentTypeId).toBe("No se puede cambiar a otra unidad: el equipo ya tiene registros.")
  })

  it("con un registro vigente la lectura inicial sigue fija, y la ficha lo sabe", async () => {
    const { countEquipmentRecords } = await import("@/lib/services/mantencion/equipment")
    const vehicleId = await equipmentWithRecords("KA-707", "BCDF-87", [["rec-eqn-7a", "2026-10-10", 5_000, "vigente"], ["rec-eqn-7b", "2026-10-11", 5_100, "anulado"]])
    expect(await countEquipmentRecords(vehicleId)).toBe(1)
    const locked = await updateEquipmentPlan(actor, vehicleId, { scheduleId: scheduleKm, initialReading: 100, initialReadingDate: "2026-10-01" }, active)
    expect(!locked.ok && locked.fieldErrors.initialReading).toMatch(/ya tiene registros/)
  })

  it("la carga de toda la flota trae lo de cada equipo en una pasada", async () => {
    const { loadEquipmentCurrents } = await import("@/lib/services/mantencion/equipment-resolve")
    const currents = new Map((await loadEquipmentCurrents(testDb)).map((item) => [item.fields.code, item]))
    expect(currents.get("KA-703")).toMatchObject({ recordCount: 3, activeRecordCount: 2, firstActiveRecord: { date: "2026-10-05", reading: 4_500 } })
    expect(currents.get("KA-705")).toMatchObject({ recordCount: 1, activeRecordCount: 0, firstActiveRecord: null })
    expect(currents.get("KA-610")).toMatchObject({ recordCount: 1, activeRecordCount: 1 })
  })
})

// Decisión del usuario (2026-11-25): la unidad de un equipo de Mantención es la de su perfil. Un camión de producción
// mide en horas aunque su tipo sea de odómetro, y uno de Biodiversa en km. Combustible no cambia: su medidor es otro.
describe("unidad de medida del equipo: camiones de producción en horas, Biodiversa en km", () => {
  async function fuelRow(vehicleId: string) {
    const [row] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    return row!
  }
  /** Compara `updated_at` del perfil en la base: su texto no es ISO, así que no se compara en JS. */
  async function profileUpdatedAfter(vehicleId: string, instant: string): Promise<boolean> {
    const [row] = await testDb
      .select({ after: sql<boolean>`${schema.mantEquipmentProfiles.updatedAt} > ${instant}::timestamptz` })
      .from(schema.mantEquipmentProfiles)
      .where(eq(schema.mantEquipmentProfiles.vehicleId, vehicleId))
    return row?.after === true
  }
  async function setOldUpdatedAt(vehicleId: string) {
    await testDb.update(schema.mantEquipmentProfiles).set({ updatedAt: "2020-01-01T00:00:00.000Z" }).where(eq(schema.mantEquipmentProfiles.vehicleId, vehicleId))
  }

  it("(a) el alta de un camión: en una faena que no es Biodiversa mide en horas; en Biodiversa, en km; el medidor de Combustible queda como el del tipo", async () => {
    const otra = await createdId(await createEquipment(actor, input({ code: "CM-100", plate: "BCDG-10", equipmentTypeId: T.camion, worksiteId: WS.arauco })))
    const bio = await createdId(await createEquipment(actor, input({ code: "CM-101", plate: "BCDG-11", equipmentTypeId: T.tracto, worksiteId: WS.bio })))
    expect(await profileOf(otra)).toMatchObject({ unit: "h" })
    expect(await profileOf(bio)).toMatchObject({ unit: "km" })
    expect(await fuelRow(otra)).toMatchObject({ meterType: "odometer", performanceUnit: "km_per_liter" })
    expect(await fuelRow(bio)).toMatchObject({ meterType: "odometer", performanceUnit: "km_per_liter" })
  })

  it("(b) editar otros campos de un camión en horas no lo devuelve a km ni toca el medidor de Combustible", async () => {
    const id = await createdId(await createEquipment(actor, input({ code: "CM-102", plate: "BCDG-18", equipmentTypeId: T.camion, worksiteId: WS.arauco })))
    const fuelBefore = await fuelRow(id)
    expect(await editIdentity(id, { model: "FH 540", year: 2023 })).toMatchObject({ ok: true })
    expect(await updateEquipmentPlan(actor, id, { scheduleId: null, initialReading: 2_000, initialReadingDate: "2026-10-01" }, { active: true, retiredReason: "" })).toMatchObject({ ok: true })
    expect(await profileOf(id)).toMatchObject({ unit: "h", initialReading: 2_000 })
    expect(await fuelRow(id)).toMatchObject({ equipmentTypeId: T.camion, meterType: fuelBefore.meterType, performanceUnit: fuelBefore.performanceUnit })
  })

  it("(c) un camión en horas con registros puede pasar de «Camión» a «Tractocamión»: sigue en horas", async () => {
    const id = await createdId(await createEquipment(actor, input({ code: "CM-103", plate: "BCDG-13", equipmentTypeId: T.camion, worksiteId: WS.arauco })))
    await testDb.insert(schema.mantRecords).values({
      id: "rec-cm-103", kind: "C", vehicleId: id, equipmentSnapshot: { code: "CM-103", plate: "BCDG-13", noPlate: false, type: "Camión", brand: "Scania", model: null, year: null, worksite: "Arauco", unit: "h" },
      worksiteId: WS.arauco, reading: 1_500, unit: "h", workDate: "2026-10-10", registeredBy: actor.userId, executorKind: "yo", executorUserId: actor.userId,
      executorName: "Jefatura Equipos", signedAt: "2026-10-10T12:00:00.000Z",
    })
    const result = await editIdentity(id, { equipmentTypeId: T.tracto })
    expect(result && result.ok && result.resolved).toMatchObject({ type: { id: T.tracto }, unit: "h" })
    expect(await profileOf(id)).toMatchObject({ unit: "h" })
    expect(await fuelRow(id)).toMatchObject({ equipmentTypeId: T.tracto, meterType: "odometer" })
  })

  it("(d) una pauta en km se rechaza para un camión en horas; la de horas se acepta, y en Biodiversa la de km", async () => {
    const rejected = await createEquipment(actor, input({ code: "CM-104", plate: "BCDG-14", equipmentTypeId: T.camion, worksiteId: WS.arauco, scheduleId: scheduleKm }))
    expect(rejected).toMatchObject({ ok: false, fieldErrors: { scheduleId: "Esa pauta se mide en kilómetros y el equipo en horas." } })
    const accepted = await createdId(await createEquipment(actor, input({ code: "CM-104", plate: "BCDG-14", equipmentTypeId: T.camion, worksiteId: WS.arauco, scheduleId: scheduleH })))
    expect(await profileOf(accepted)).toMatchObject({ unit: "h", scheduleId: scheduleH })
    const bio = await createdId(await createEquipment(actor, input({ code: "CM-105", plate: "BCDG-15", equipmentTypeId: T.camion, worksiteId: WS.bio, scheduleId: scheduleKm })))
    expect(await profileOf(bio)).toMatchObject({ unit: "km", scheduleId: scheduleKm })
  })

  it("el perfil sube su updated_at cuando cambia la unidad: por el cambio de tipo del padrón y por setEquipmentUnit", async () => {
    const id = await createdId(await createEquipment(actor, input({ code: "CM-106", plate: "BCDG-16", equipmentTypeId: T.km, worksiteId: WS.arauco })))
    await setOldUpdatedAt(id)
    expect(await profileUpdatedAfter(id, "2020-01-01T00:00:00Z")).toBe(false)
    // De odómetro a horas, sin registros ni pauta: la unidad del tipo nuevo, y el perfil lo registra.
    const padron = await editIdentity(id, { equipmentTypeId: T.h })
    expect(padron && padron.ok && padron.resolved.unit).toBe("h")
    expect(await profileOf(id)).toMatchObject({ unit: "h" })
    expect(await profileUpdatedAfter(id, "2020-01-01T00:00:00Z")).toBe(true)

    await setOldUpdatedAt(id)
    const changed = await testDb.transaction((tx) => setEquipmentUnit(tx, actor, { vehicleId: id, unit: "km", reason: "Se mide en kilómetros según jefatura" }))
    expect(changed).toMatchObject({ ok: true, data: { changed: true, unit: "km" } })
    expect(await profileUpdatedAfter(id, "2020-01-01T00:00:00Z")).toBe(true)
  })

  describe("setEquipmentUnit: el cambio de unidad de una sola vez", () => {
    const REASON = "Se mide en kilómetros según jefatura"
    let id = ""

    it("cambia la unidad, libera la pauta y limpia la lectura inicial y la preventiva declarada; conserva los registros; deja historial y auditoría; no toca Combustible", async () => {
      id = await createdId(await createEquipment(actor, input({ code: "CM-200", plate: "BCDG-20", equipmentTypeId: T.camion, worksiteId: WS.arauco, scheduleId: scheduleH, initialReading: 1_000, initialReadingDate: "2026-09-01" })))
      expect(await updateEquipmentPlan(actor, id, {
        scheduleId: scheduleH, initialReading: 1_000, initialReadingDate: "2026-09-01",
        priorPreventive: { date: "2026-08-15", reading: 900, intervalValue: 300, evidence: "OT 12345" },
      }, { active: true, retiredReason: "" })).toMatchObject({ ok: true })
      await testDb.insert(schema.mantRecords).values({
        id: "rec-cm-200", kind: "C", vehicleId: id, equipmentSnapshot: { code: "CM-200", plate: "BCDG-20", noPlate: false, type: "Camión", brand: "Scania", model: null, year: null, worksite: "Arauco", unit: "h" },
        worksiteId: WS.arauco, reading: 1_100, unit: "h", workDate: "2026-10-10", registeredBy: actor.userId, executorKind: "yo", executorUserId: actor.userId,
        executorName: "Jefatura Equipos", signedAt: "2026-10-10T12:00:00.000Z",
      })
      const fuelBefore = await fuelRow(id)
      const auditsBefore = (await audits("mant_equipment", id)).length
      const historyBefore = (await listEquipmentHistory(id)).length

      const result = await testDb.transaction((tx) => setEquipmentUnit(tx, actor, { vehicleId: id, unit: "km", reason: REASON }))
      expect(result).toMatchObject({ ok: true, data: { changed: true, unit: "km" } })
      expect(await profileOf(id)).toMatchObject({
        unit: "km", scheduleId: null, initialReading: null, initialReadingDate: null,
        priorPreventiveDate: null, priorPreventiveReading: null, priorPreventiveInterval: null, priorPreventiveEvidence: null,
        priorPreventiveDeclaredBy: null, priorPreventiveSource: null,
      })
      // Los registros siguen como se midieron: son historia, no se anulan ni se reescriben.
      const records = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.vehicleId, id))
      expect(records).toEqual([expect.objectContaining({ id: "rec-cm-200", status: "vigente", unit: "h", reading: 1_100 })])
      // Combustible no cambia: ni su medidor, ni su rendimiento, ni su fila.
      expect(await fuelRow(id)).toEqual(fuelBefore)
      // Historial y auditoría del mismo cambio.
      const entry = (await listEquipmentHistory(id)).find((item) => item.summary.startsWith("Cambio de unidad de medida"))
      expect(entry).toMatchObject({ action: "update" })
      expect(entry?.summary).toContain("Unidad de medida: horas → kilómetros")
      expect(entry?.summary).toContain(`Motivo: ${REASON}`)
      expect(Object.keys(entry?.changes ?? {}).sort()).toEqual([
        "Fecha de la lectura inicial", "Fecha de la preventiva declarada (anterior a la plataforma)", "Lectura de la preventiva declarada",
        "Lectura inicial", "Pauta", "Respaldo de la preventiva declarada", "Servicio de la preventiva declarada", "Unidad de medida",
      ])
      expect((await listEquipmentHistory(id)).length).toBe(historyBefore + 1)
      const audit = (await audits("mant_equipment", id)).find((row) => row.reason === REASON)
      expect(audit).toMatchObject({ action: "update", entityCode: "CM-200" })
      expect((await audits("mant_equipment", id)).length).toBe(auditsBefore + 1)
    })

    it("es idempotente: una segunda corrida con la misma unidad no escribe nada", async () => {
      const before = { profile: await profileOf(id), history: (await listEquipmentHistory(id)).length, audits: (await audits("mant_equipment", id)).length }
      const again = await testDb.transaction((tx) => setEquipmentUnit(tx, actor, { vehicleId: id, unit: "km", reason: REASON }))
      expect(again).toMatchObject({ ok: true, data: { changed: false, unit: "km", changes: {} } })
      expect(await profileOf(id)).toEqual(before.profile)
      expect((await listEquipmentHistory(id)).length).toBe(before.history)
      expect((await audits("mant_equipment", id)).length).toBe(before.audits)
    })

    it("rechaza una pauta de la unidad vieja, una lectura sin fecha y un motivo corto, sin escribir nada", async () => {
      const fresh = await createdId(await createEquipment(actor, input({ code: "CM-201", plate: "BCDG-21", equipmentTypeId: T.camion, worksiteId: WS.arauco })))
      const before = await profileOf(fresh)
      const badSchedule = await testDb.transaction((tx) => setEquipmentUnit(tx, actor, { vehicleId: fresh, unit: "km", scheduleId: scheduleH, reason: REASON }))
      expect(badSchedule).toMatchObject({ ok: false, fieldErrors: { scheduleId: "Esa pauta se mide en horas y el equipo quedaría en kilómetros." } })
      const noDate = await testDb.transaction((tx) => setEquipmentUnit(tx, actor, { vehicleId: fresh, unit: "km", initialReading: 500, reason: REASON }))
      expect(noDate).toMatchObject({ ok: false, fieldErrors: { initialReadingDate: "Indica la fecha de la lectura inicial." } })
      const shortReason = await testDb.transaction((tx) => setEquipmentUnit(tx, actor, { vehicleId: fresh, unit: "km", reason: "x" }))
      expect(shortReason).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } })
      expect(await profileOf(fresh)).toEqual(before)
    })

    it("un vehículo que no está en Mantención no se toca", async () => {
      const result = await testDb.transaction((tx) => setEquipmentUnit(tx, actor, { vehicleId: "veh-inactivo", unit: "h", reason: REASON }))
      expect(result).toMatchObject({ ok: false, message: "Ese equipo no está en Mantención." })
    })

    it("una pauta de la unidad nueva se conserva si se pasa, y la lectura inicial nueva va con su fecha", async () => {
      const fresh = await createdId(await createEquipment(actor, input({ code: "CM-202", plate: "BCDG-22", equipmentTypeId: T.km, worksiteId: WS.arauco, scheduleId: scheduleKm })))
      const result = await testDb.transaction((tx) => setEquipmentUnit(tx, actor, {
        vehicleId: fresh, unit: "h", scheduleId: scheduleH, initialReading: 300, initialReadingDate: "2026-10-01", reason: "Se mide en horas según jefatura",
      }))
      expect(result).toMatchObject({ ok: true, data: { changed: true, unit: "h" } })
      expect(await profileOf(fresh)).toMatchObject({ unit: "h", scheduleId: scheduleH, initialReading: 300, initialReadingDate: "2026-10-01" })
      expect(await fuelRow(fresh)).toMatchObject({ meterType: "odometer" })
    })
  })

  it("la importación valida la pauta contra la unidad del equipo: un camión fuera de Biodiversa acepta horas y rechaza km; en Biodiversa, km", async () => {
    const rows: Array<Array<string | number | null>> = [
      ["IMC-1", "BCDG-31", "Camión producción (prueba)", "Scania", null, null, "Arauco", "Maquinaria prueba", 800, "01-10-2026"],
      ["IMC-2", "BCDG-32", "Camión producción (prueba)", "Scania", null, null, "Arauco", "Camiones prueba", 800, "01-10-2026"],
      ["IMC-3", "BCDG-33", "Camión producción (prueba)", "Scania", null, null, "Biodiversa", "Camiones prueba", 800, "01-10-2026"],
    ]
    const preview = await previewEquipmentImport(await workbookBuffer(rows))
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(Object.fromEntries(preview.data.rows.map((row) => [row.code, row.kind]))).toEqual({ "IMC-1": "create", "IMC-2": "error", "IMC-3": "create" })
    expect(preview.data.rows.find((row) => row.code === "IMC-2")?.messages.join(" ")).toMatch(/Esa pauta se mide en kilómetros y el equipo en horas/)

    const commit = await commitEquipmentImport(actor, await workbookBuffer(rows), "equipos.xlsx")
    expect(commit).toMatchObject({ ok: true, data: { created: 2, errors: 1 } })
    const [horas] = await vehicleByCode("IMC-1")
    const [bio] = await vehicleByCode("IMC-3")
    expect(await profileOf(horas!.id)).toMatchObject({ unit: "h", scheduleId: scheduleH })
    expect(await profileOf(bio!.id)).toMatchObject({ unit: "km", scheduleId: scheduleKm })
    const [horasVehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, horas!.id))
    expect(horasVehicle).toMatchObject({ meterType: "odometer" })
  })
})
