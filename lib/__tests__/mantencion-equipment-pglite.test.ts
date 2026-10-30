import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import ExcelJS from "exceljs"
import { eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

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
  createEquipment, updateEquipment, retireEquipment, reactivateEquipment, NEW_WORKSITE,
} = await import("@/lib/services/mantencion/equipment")
type EquipmentInput = import("@/lib/services/mantencion/equipment").EquipmentInput
const { listEquipmentHistory } = await import("@/lib/services/mantencion/equipment-history")
const { previewEquipmentImport, commitEquipmentImport, buildEquipmentTemplate } = await import("@/lib/services/mantencion/equipment-import")

const actor = { userId: "u-jefe-eq", email: "jefe@example.test" }
const T = { km: "t-camion", h: "t-excavadora", none: "t-estanque" } as const
const B = { scania: "b-scania", volvo: "b-volvo" } as const
const WS = { arauco: "ws-arauco", cholguan: "ws-cholguan", teno: "ws-teno" } as const

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

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: actor.userId, name: "Jefatura Equipos", email: actor.email, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([
    { id: WS.arauco, name: "Arauco", code: "FN-ARA", isActive: true },
    { id: WS.cholguan, name: "Cholguan", code: "FN-CHO", isActive: true },
    { id: WS.teno, name: "Teno", code: "FN-TEN", isActive: false },
  ])
  await testDb.insert(schema.fuelEquipmentTypes).values([
    { id: T.km, slug: "test-camion", name: "Camión (prueba)", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" },
    { id: T.h, slug: "test-excavadora", name: "Excavadora (prueba)", category: "heavy", defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour" },
    { id: T.none, slug: "test-estanque", name: "Estanque (prueba)", category: "storage", defaultMeterType: "none", defaultPerformanceUnit: "not_applicable" },
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

  it("una faena nueva escrita con otra tilde o mayúscula reutiliza la existente (regla 17)", async () => {
    const before = (await testDb.select().from(schema.worksites)).length
    const vehicleId = await createdId(await createEquipment(actor, input({ code: "KA-504", plate: "HJKL-12", worksiteId: NEW_WORKSITE, newWorksiteName: "  cholguán " })))
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    expect(vehicle?.worksiteId).toBe(WS.cholguan)
    expect((await testDb.select().from(schema.worksites)).length).toBe(before)
  })

  it("una faena realmente nueva se crea con su folio, y una inactiva se rechaza", async () => {
    const vehicleId = await createdId(await createEquipment(actor, input({ code: "KA-505", plate: "KLPR-12", worksiteId: NEW_WORKSITE, newWorksiteName: "Flor del Laja" })))
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    const [site] = await testDb.select().from(schema.worksites).where(eq(schema.worksites.id, vehicle!.worksiteId))
    expect(site?.name).toBe("Flor del Laja")
    const [settings] = await testDb.select().from(schema.mantWorksiteSettings).where(eq(schema.mantWorksiteSettings.worksiteId, site!.id))
    expect(settings?.folioCode).toMatch(/^[A-Z]{3}$/)

    const inactive = await createEquipment(actor, input({ code: "KA-506", plate: "WXYZ-34", worksiteId: NEW_WORKSITE, newWorksiteName: "teno" }))
    expect(!inactive.ok && inactive.fieldErrors.worksiteId).toMatch(/existe pero está inactiva/)
  })
})

describe("edición, unidad fija y baja", () => {
  let vehicleId = ""
  it("registra los cambios con etiquetas en español y una sola fila de historial", async () => {
    vehicleId = await createdId(await createEquipment(actor, input({ code: "KA-600", plate: "RSTV-12", scheduleId: scheduleKm })))
    const result = await updateEquipment(actor, vehicleId, input({ code: "KA-600", plate: "RSTV-12", model: "R500", year: 2022, scheduleId: scheduleKm, worksiteId: WS.cholguan }), { active: true, retiredReason: "" })
    expect(result).toMatchObject({ ok: true, data: { changed: true } })
    const [latest] = await listEquipmentHistory(vehicleId)
    expect(latest?.action).toBe("update")
    expect(latest?.summary).toContain("Modelo: R450 → R500")
    expect(latest?.summary).toContain("Faena: Arauco → Cholguan")
    // jsonb no conserva el orden de las llaves: se compara el conjunto.
    expect(Object.keys(latest?.changes ?? {}).sort()).toEqual(["Año", "Faena", "Modelo"])
    // Sin cambios no escribe nada.
    const again = await updateEquipment(actor, vehicleId, input({ code: "KA-600", plate: "RSTV-12", model: "R500", year: 2022, scheduleId: scheduleKm, worksiteId: WS.cholguan }), { active: true, retiredReason: "" })
    expect(again).toMatchObject({ ok: true, data: { changed: false } })
    expect(await listEquipmentHistory(vehicleId)).toHaveLength(2)
  })

  it("cambiar sólo la pauta queda como schedule_change", async () => {
    await updateEquipment(actor, vehicleId, input({ code: "KA-600", plate: "RSTV-12", model: "R500", year: 2022, scheduleId: null, worksiteId: WS.cholguan }), { active: true, retiredReason: "" })
    const [latest] = await listEquipmentHistory(vehicleId)
    expect(latest).toMatchObject({ action: "schedule_change", summary: "Pauta quitada: «Camiones prueba»" })
  })

  it("no deja cambiar el tipo a otra unidad cuando el equipo ya tiene registros", async () => {
    await testDb.insert(schema.mantRecords).values({
      id: "rec-eq-1", kind: "C", vehicleId, equipmentSnapshot: { code: "KA-600", plate: "RSTV-12", noPlate: false, type: "Camión", brand: "Scania", model: null, year: null, worksite: "Cholguan", unit: "km" },
      worksiteId: WS.cholguan, reading: 5000, unit: "km", workDate: "2026-10-10", registeredBy: actor.userId, executorKind: "yo", executorUserId: actor.userId,
      executorName: "Jefatura Equipos", signedAt: "2026-10-10T12:00:00.000Z",
    })
    const blocked = await updateEquipment(actor, vehicleId, input({ code: "KA-600", plate: "RSTV-12", equipmentTypeId: T.h, model: "R500", year: 2022, worksiteId: WS.cholguan }), { active: true, retiredReason: "" })
    expect(!blocked.ok && blocked.fieldErrors.equipmentTypeId).toBe("No se puede cambiar a otra unidad: el equipo ya tiene registros.")
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    expect(vehicle?.equipmentTypeId).toBe(T.km)
    // La lectura inicial también queda fija.
    const locked = await updateEquipment(actor, vehicleId, input({ code: "KA-600", plate: "RSTV-12", model: "R500", year: 2022, worksiteId: WS.cholguan, initialReading: 100, initialReadingDate: "2026-10-01" }), { active: true, retiredReason: "" })
    expect(!locked.ok && locked.fieldErrors.initialReading).toMatch(/ya tiene registros/)
  })

  it("permite cambiar el tipo a otra unidad mientras no tenga registros, con el medidor del tipo nuevo", async () => {
    const free = await createdId(await createEquipment(actor, input({ code: "KA-601", plate: "STVW-12" })))
    const changed = await updateEquipment(actor, free, input({ code: "KA-601", plate: "STVW-12", equipmentTypeId: T.h }), { active: true, retiredReason: "" })
    expect(changed.ok).toBe(true)
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, free))
    expect(vehicle).toMatchObject({ equipmentTypeId: T.h, meterType: "hour_meter", type: "test-excavadora" })
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

  it("la edición con baja es atómica: sin motivo no cambia nada", async () => {
    const result = await updateEquipment(actor, vehicleId, input({ code: "KA-600", plate: "RSTV-12", model: "XXX", year: 2022, worksiteId: WS.cholguan }), { active: false, retiredReason: "" })
    expect(!result.ok && result.fieldErrors.retiredReason).toBeTruthy()
    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
    expect(vehicle?.model).toBe("R500")
    expect(vehicle?.isActive).toBe(true)
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
    expect(errorRow?.messages.join(" ")).toMatch(/Marca X/)
    expect(preview.data.rows.find((row) => row.row === 7)?.messages[0]).toMatch(/ya aparece en la fila 2/)
    expect(preview.data.rows.find((row) => row.row === 8)?.messages.join(" ")).toMatch(/se mide en horas/)
    const updateRow = preview.data.rows.find((row) => row.row === 4)
    expect(updateRow?.messages).toHaveLength(1)
    expect(updateRow?.messages[0]).toContain("Modelo:")
    expect((await testDb.select().from(schema.fuelVehicles)).length).toBe(before)
    expect(await testDb.select().from(schema.worksites).where(eq(schema.worksites.name, "Faena Importada"))).toHaveLength(0)
  })

  it("al confirmar escribe sólo las filas válidas, con historial «import» y una auditoría", async () => {
    const result = await commitEquipmentImport(actor, await workbookBuffer(ROWS), "equipos.xlsx")
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
    expect(active).toEqual([expect.objectContaining({ worksiteId: WS.arauco, vehicleId: "veh-flota-map", version: 2 })])
    expect(closed).toEqual([expect.objectContaining({ worksiteId: WS.cholguan, version: 1 })])
  })

  it("al editar la faena del equipo, y no al editar otra cosa", async () => {
    const vehicleId = await createdId(await createEquipment(actor, input({ code: "KA-710", plate: "JKLP-71", worksiteId: WS.arauco })))
    await mapPlate(vehicleId, "JKLP71", WS.arauco)

    await updateEquipment(actor, vehicleId, input({ code: "KA-710", plate: "JKLP-71", model: "R460", worksiteId: WS.arauco }), { active: true, retiredReason: "" })
    expect((await activeMapping("JKLP71")).closed).toHaveLength(0)

    await updateEquipment(actor, vehicleId, input({ code: "KA-710", plate: "JKLP-71", model: "R460", worksiteId: WS.cholguan }), { active: true, retiredReason: "" })
    const { active, closed } = await activeMapping("JKLP71")
    expect(active).toEqual([expect.objectContaining({ worksiteId: WS.cholguan, version: 2 })])
    expect(closed).toEqual([expect.objectContaining({ worksiteId: WS.arauco })])
  })
})
