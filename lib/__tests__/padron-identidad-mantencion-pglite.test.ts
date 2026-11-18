/**
 * La identidad del vehículo en un solo lugar (crítica UI/UX de Control operacional, 2026-11-15,
 * paso 4b), contra Postgres de verdad y por la acción del padrón, que es la que llama la ficha:
 *
 * - un vehículo que está en Mantención se guarda con las reglas de Mantención (código, patente
 *   de la regla 16, tipo con unidad, unidad fija con registros, marca de la lista) y cada cambio
 *   queda en su historial;
 * - la marca y «Sin patente» son del perfil: sin `mant:equipment:manage` se conservan;
 * - un vehículo que no está en Mantención se guarda como siempre (marca en texto libre);
 * - cambiar la faena desde el padrón se rechaza: sólo cambia por «Trasladar equipos» (tampoco toca las asignaciones);
 * - la importación desde Excel del padrón pasa por las mismas reglas, fila por fila.
 */

import path from "node:path"
import ExcelJS from "exceljs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
const mockAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/services/notifications", () => ({ notifyAfterCommit: vi.fn(), notifySafe: vi.fn(), notifyManyUser: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { updateFuelVehicleAction, importFuelVehiclesFromXlsx, toggleFuelVehicleActiveAction, bulkToggleFuelVehicleActiveAction } = await import("@/app/(app)/combustibles/actions-module/vehicles")
const { createEquipment } = await import("@/lib/services/mantencion/equipment")
const { listEquipmentHistory } = await import("@/lib/services/mantencion/equipment-history")

const WS = { arauco: "ws-arauco", cholguan: "ws-cholguan" } as const
const T = { km: "t-camion", h: "t-excavadora" } as const
const B = { scania: "b-scania", volvo: "b-volvo" } as const
const ADMIN = "u-admin-padron"
const mantActor = { userId: ADMIN, email: "jefe@example.test" }

function session(permissions: string[], options: { worksiteIds?: string[]; isGlobal?: boolean } = {}): Session {
  const worksiteIds = options.worksiteIds ?? [WS.arauco, WS.cholguan]
  return {
    user: {
      id: ADMIN, name: "Padrón", email: "jefe@example.test", roles: [], permissions, worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true, isGlobal: options.isGlobal ?? true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session
}

/** Jefe de mantención: padrón y equipos de Mantención. */
const JEFE = session(["admin:fleet_vehicles", "mant:equipment:manage"])
/** Secretaría: el padrón, sin Mantención. */
const SECRETARIA = session(["admin:fleet_vehicles"], { isGlobal: false })

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }
  return data
}

/** Lo que el formulario del padrón manda siempre: id, medidor y productos. */
const base = (id: string) => ({ id, meterType: "odometer", performanceUnit: "km_per_liter", compatibleProductIds: ["prod-diesel"] })

async function save(as: Session, fields: Record<string, string | string[]>) {
  mockAuth.mockResolvedValue(as)
  return updateFuelVehicleAction({ ok: false }, form(fields))
}

async function vehicle(id: string) {
  const [row] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, id))
  return row!
}

async function profile(id: string) {
  const [row] = await testDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, id))
  return row!
}

async function created(input: { code: string; plate: string; scheduleId?: string | null }): Promise<string> {
  const result = await createEquipment(mantActor, {
    code: input.code, plate: input.plate, noPlate: false, equipmentTypeId: T.km, brandId: B.scania, model: "R450", year: 2021,
    worksiteId: WS.arauco, newWorksiteName: "", scheduleId: input.scheduleId ?? null, initialReading: null, initialReadingDate: null,
  })
  if (!result.ok) throw new Error(result.message)
  return result.data.vehicleId
}

/** Deja activo un vehículo de prueba que otra prueba usa después. */
async function inMemoryReactivate(id: string) {
  await testDb.update(schema.fuelVehicles).set({ isActive: true }).where(eq(schema.fuelVehicles.id, id))
}

async function addRecord(vehicleId: string, id: string) {
  await testDb.insert(schema.mantRecords).values({
    id, kind: "C", vehicleId, equipmentSnapshot: { code: "X", plate: "X", noPlate: false, type: "Camión", brand: "Scania", model: null, year: null, worksite: "Arauco", unit: "km" },
    worksiteId: WS.arauco, reading: 5000, unit: "km", workDate: "2026-10-10", registeredBy: ADMIN, executorKind: "yo", executorUserId: ADMIN,
    executorName: "Padrón", signedAt: "2026-10-10T12:00:00.000Z",
  })
}

beforeAll(async () => {
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: ADMIN, name: "Padrón", email: "jefe@example.test", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([
    { id: WS.arauco, name: "Arauco", code: "FN-ARA", isActive: true },
    { id: WS.cholguan, name: "Cholguan", code: "FN-CHO", isActive: true },
  ])
  await testDb.insert(schema.fuelEquipmentTypes).values([
    { id: T.km, slug: "test-camion", name: "Camión (prueba)", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" },
    { id: T.h, slug: "test-excavadora", name: "Excavadora (prueba)", category: "heavy", defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour" },
  ])
  await testDb.insert(schema.fuelProducts).values({ id: "prod-diesel", code: "DIESEL-R", name: "Diésel prueba", category: "diesel" }).onConflictDoNothing()
  await testDb.insert(schema.mantBrands).values([
    { id: B.scania, name: "Scania", nameKey: "scania" },
    { id: B.volvo, name: "Volvo", nameKey: "volvo" },
  ])
  await testDb.insert(schema.fuelVehicles).values({
    id: "veh-solo-flota", plate: "GHJK-34", code: "KA-300", type: "test-camion", equipmentTypeId: T.km, worksiteId: WS.arauco, brand: "Volvo FH", isActive: true,
  })
})

describe("padrón de un vehículo que está en Mantención", () => {
  let id = ""

  it("con permiso de Mantención cambia la marca de la lista; el vehículo guarda su nombre y el historial lo dice", async () => {
    id = await created({ code: "KA-800", plate: "RSTV-12" })
    const result = await save(JEFE, { ...base(id), brandId: B.volvo, model: "R500" })
    expect(result).toMatchObject({ ok: true })
    expect(await vehicle(id)).toMatchObject({ brand: "Volvo", model: "R500" })
    expect(await profile(id)).toMatchObject({ brandId: B.volvo })
    const [latest] = await listEquipmentHistory(id)
    expect(latest?.summary).toBe("Editado en Vehículos · Marca: Scania → Volvo · Modelo: R450 → R500")
  })

  it("sin permiso de Mantención la marca se conserva aunque el formulario mande otra; lo demás se guarda", async () => {
    const result = await save(SECRETARIA, { ...base(id), brandId: B.scania, noPlate: "1", model: "R510" })
    expect(result).toMatchObject({ ok: true })
    expect(await vehicle(id)).toMatchObject({ brand: "Volvo", model: "R510", plate: "RSTV-12" })
    expect(await profile(id)).toMatchObject({ brandId: B.volvo, noPlate: false })
    const [latest] = await listEquipmentHistory(id)
    expect(Object.keys(latest?.changes ?? {})).toEqual(["Modelo"])
  })

  it("«Sin patente» deja el código como patente, con permiso de Mantención", async () => {
    expect(await save(JEFE, { ...base(id), noPlate: "1" })).toMatchObject({ ok: true })
    expect(await vehicle(id)).toMatchObject({ plate: "KA-800" })
    expect(await profile(id)).toMatchObject({ noPlate: true })
    expect(await save(JEFE, { ...base(id), noPlate: "0", plate: "rstv 12" })).toMatchObject({ ok: true })
    expect(await vehicle(id)).toMatchObject({ plate: "RSTV-12" })
  })

  it("el código es obligatorio y la patente sigue la regla 16", async () => {
    const noCode = await save(JEFE, { ...base(id), code: "" })
    expect(noCode).toMatchObject({ ok: false, fieldErrors: { code: ["Escribe el código interno."] } })
    const badPlate = await save(JEFE, { ...base(id), plate: "ABC-123" })
    expect(badPlate).toMatchObject({ ok: false, fieldErrors: { plate: [expect.stringMatching(/no es una patente válida/)] } })
    expect(await vehicle(id)).toMatchObject({ code: "KA-800", plate: "RSTV-12" })
  })

  it("con registros no pasa a un tipo de otra unidad, y no guarda nada de ese envío", async () => {
    await addRecord(id, "rec-padron-1")
    const blocked = await save(JEFE, { ...base(id), equipmentTypeId: T.h, meterType: "hour_meter", performanceUnit: "liters_per_hour", model: "Otro" })
    expect(blocked).toMatchObject({ ok: false, fieldErrors: { equipmentTypeId: ["No se puede cambiar a otra unidad: el equipo ya tiene registros."] } })
    expect(await vehicle(id)).toMatchObject({ equipmentTypeId: T.km, meterType: "odometer", model: "R510" })
  })

  it("cambiar la faena desde el padrón se rechaza: sólo cambia por «Trasladar equipos» y nada se mueve", async () => {
    await testDb.insert(schema.fuelProviderMappings).values({
      id: "map-RSTV12", provider: "copec", sourceAccount: "tct:diesel", externalKey: "RSTV12", normalizedValue: "RSTV12",
      worksiteId: WS.arauco, vehicleId: id, decidedBy: ADMIN, reason: "prueba", effectiveFrom: "2026-01-01",
    })
    const historyBefore = (await listEquipmentHistory(id)).length
    expect(await save(JEFE, { ...base(id), worksiteId: WS.cholguan })).toMatchObject({
      ok: false, fieldErrors: { worksiteId: ["Para cambiar de faena usa «Trasladar equipos»."] },
    })
    expect(await vehicle(id)).toMatchObject({ worksiteId: WS.arauco })
    const mappings = await testDb.select().from(schema.fuelProviderMappings).where(eq(schema.fuelProviderMappings.externalKey, "RSTV12"))
    expect(mappings.filter((row) => row.isActive)).toEqual([expect.objectContaining({ worksiteId: WS.arauco })])
    expect(await testDb.select().from(schema.fleetTransfers)).toHaveLength(0)
    expect((await listEquipmentHistory(id)).length).toBe(historyBefore)
  })
})

describe("activar y desactivar en el padrón un equipo de Mantención (paso 6)", () => {
  it("desactivar es su baja: motivo en el perfil y fila en su historial; reactivar lo deshace", async () => {
    const id = await created({ code: "KA-830", plate: "WXYZ-12" })
    mockAuth.mockResolvedValue(SECRETARIA)
    expect(await toggleFuelVehicleActiveAction(id, false, "Vendido a un tercero")).toMatchObject({ ok: true })
    expect(await vehicle(id)).toMatchObject({ isActive: false })
    expect(await profile(id)).toMatchObject({ retiredReason: "Vendido a un tercero" })
    expect((await listEquipmentHistory(id))[0]).toMatchObject({ action: "retire", summary: "Dado de baja en Vehículos: Vendido a un tercero" })

    expect(await toggleFuelVehicleActiveAction(id, true, "Se recompró el equipo")).toMatchObject({ ok: true })
    expect(await profile(id)).toMatchObject({ retiredReason: null })
    expect((await listEquipmentHistory(id))[0]).toMatchObject({ action: "reactivate", summary: "Reactivado en Vehículos: Se recompró el equipo" })
  })

  it("en lote: sólo los que cambian y sólo los que están en Mantención dejan historial", async () => {
    const id = await created({ code: "KA-831", plate: "XYZW-12" })
    mockAuth.mockResolvedValue(JEFE)
    const form = new FormData()
    form.set("ids", `${id},veh-solo-flota`)
    form.set("activate", "false")
    form.set("reason", "Fin del contrato de la faena")
    expect(await bulkToggleFuelVehicleActiveAction({ ok: false }, form)).toMatchObject({ ok: true, message: "2 vehículos desactivados" })
    expect(await profile(id)).toMatchObject({ retiredReason: "Fin del contrato de la faena" })
    expect((await listEquipmentHistory(id)).filter((entry) => entry.action === "retire")).toHaveLength(1)
    expect(await listEquipmentHistory("veh-solo-flota")).toHaveLength(0)
    // Volver a desactivar los ya inactivos no repite la baja.
    expect(await bulkToggleFuelVehicleActiveAction({ ok: false }, form)).toMatchObject({ ok: true })
    expect((await listEquipmentHistory(id)).filter((entry) => entry.action === "retire")).toHaveLength(1)
    await inMemoryReactivate("veh-solo-flota")
  })
})

describe("padrón de un vehículo que no está en Mantención", () => {
  it("se guarda como siempre: marca en texto libre, sin historial de Mantención", async () => {
    expect(await save(SECRETARIA, { ...base("veh-solo-flota"), brand: "Volvo FH 540", code: "" })).toMatchObject({ ok: true })
    expect(await vehicle("veh-solo-flota")).toMatchObject({ brand: "Volvo FH 540", code: null })
    expect(await listEquipmentHistory("veh-solo-flota")).toHaveLength(0)
  })
})

describe("importación del padrón desde Excel", () => {
  async function importRows(rows: Array<Array<string | number>>) {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Vehículos")
    sheet.addRow(["CODIGO", "PATENTE", "FAENA", "TIPO", "MARCA", "MODELO", "AÑO"])
    for (const row of rows) sheet.addRow(row)
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const data = new FormData()
    data.set("file", new File([buffer], "padron.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
    mockAuth.mockResolvedValue(JEFE)
    return importFuelVehiclesFromXlsx({ ok: false }, data)
  }

  it("un equipo de Mantención se actualiza con sus reglas (la marca de la planilla no pisa la de la lista) y queda en su historial", async () => {
    const id = await created({ code: "KA-810", plate: "TVWX-12" })
    const result = await importRows([["KA-810", "TVWX-12", "Arauco", "test-camion", "SCANIA TRUCKS", "R460", 2022]])
    expect(result).toMatchObject({ ok: true })
    expect(await vehicle(id)).toMatchObject({ brand: "Scania", model: "R460", year: 2022 })
    const [latest] = await listEquipmentHistory(id)
    expect(latest?.summary).toBe("Actualizado por la importación de Vehículos · Modelo: R450 → R460 · Año: 2021 → 2022")
  })

  it("una fila que rompe las reglas de Mantención se omite con su motivo, y las demás se importan", async () => {
    const id = await created({ code: "KA-820", plate: "VWXY-12" })
    await addRecord(id, "rec-padron-2")
    const result = await importRows([
      ["KA-820", "VWXY-12", "Arauco", "test-excavadora", "Scania", "R450", 2021],
      ["KA-300", "GHJK-34", "Arauco", "test-camion", "Volvo", "FH", 2020],
    ])
    expect(result).toMatchObject({ ok: true, data: { updated: 1 } })
    const errors = (result.data as { errors: string[] }).errors
    expect(errors).toEqual([expect.stringMatching(/^Fila 2, TIPO: Equipo de Mantención: No se puede cambiar a otra unidad/)])
    expect(await vehicle(id)).toMatchObject({ equipmentTypeId: T.km })
    expect(await vehicle("veh-solo-flota")).toMatchObject({ brand: "Volvo", model: "FH" })
  })

  it("una fila que cambia la faena de un equipo existente se rechaza en su columna FAENA, y las demás se importan", async () => {
    const id = await created({ code: "KA-840", plate: "BCDF-34" })
    const result = await importRows([
      ["KA-840", "BCDF-34", "Cholguán", "test-camion", "Scania", "R999", 2022],
      ["KA-300", "GHJK-34", "Arauco", "test-camion", "Volvo", "FH 500", 2021],
    ])
    expect(result).toMatchObject({ ok: true, data: { updated: 1, totalErrors: 1 } })
    expect((result.data as { errors: string[] }).errors).toEqual(["Fila 2, FAENA: Para cambiar de faena usa «Trasladar equipos»."])
    // El equipo de la fila rechazada queda intacto (ni modelo ni faena); el resto sí se importó.
    expect(await vehicle(id)).toMatchObject({ worksiteId: WS.arauco, model: "R450" })
    expect(await vehicle("veh-solo-flota")).toMatchObject({ model: "FH 500" })
    expect(await testDb.select().from(schema.fleetTransfers)).toHaveLength(0)
  })
})
