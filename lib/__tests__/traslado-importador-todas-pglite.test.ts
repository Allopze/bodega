import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import ExcelJS from "exceljs"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { setVehicleWorksiteForTest } from "@/lib/testing/fleet-stays"

// ── Base PGlite con todas las migraciones ────────────────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime; postgres-js difiere sólo en el tipo HKT del resultado.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: async () => ({ user: { id: "test-user", isGlobal: true, worksiteIds: [], permissions: ["combustibles:import", "combustibles:manage_vehicles"] } }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/storage/helpers", () => ({
  mkdirp: vi.fn(async () => undefined),
  writeBuffer: vi.fn(async () => undefined),
  removeFile: vi.fn(async () => undefined),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { confirmConsumptionImportAction, linkConsumptionPlateAction } = await import("@/app/(app)/combustibles/actions-consumos")

/**
 * Importación de consumos en modo «todas las faenas» (revisión final, Importante #4): el
 * lote se archiva en la faena donde estuvo el equipo DURANTE el período, no en la de hoy.
 * Escenario: el equipo `moved` estuvo en `wsA` hasta el 14-11 y desde el 15-11 está en `wsB`;
 * `stay` está siempre en `wsB`.
 */
const wsA = nanoid()
const wsB = nanoid()
const eqTypeId = nanoid()
const TRANSFER_DAY = "2026-11-15"
const movedPlate = `MOV${nanoid().slice(0, 3).toUpperCase()}1`
const stayPlate = `STA${nanoid().slice(0, 3).toUpperCase()}1`
let movedId = ""

async function seedVehicle(plate: string, worksiteId: string) {
  const id = nanoid()
  await inMemoryDb.insert(schema.fuelVehicles).values({
    id, plate, type: "camion", equipmentTypeId: eqTypeId, worksiteId, meterType: "odometer", isActive: true,
  })
  return id
}

beforeAll(async () => {
  await inMemoryDb.insert(schema.users).values({ id: "test-user", name: "Importador", email: `imp-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.worksites).values([
    { id: wsA, name: "Faena A todas", code: `XA-${nanoid().slice(0, 6)}`, isActive: true },
    { id: wsB, name: "Faena B todas", code: `XB-${nanoid().slice(0, 6)}`, isActive: true },
  ])
  await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: eqTypeId, slug: `todas-${nanoid().slice(0, 6)}`, name: "Camión todas" })
  movedId = await seedVehicle(movedPlate, wsA)
  await setVehicleWorksiteForTest(inMemoryDb as never, movedId, wsB, TRANSFER_DAY)
  await seedVehicle(stayPlate, wsB)
})

let fileSeq = 0
async function confirmAll(periodoDesde: string, periodoHasta: string) {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet("Consumos")
  sheet.addRow(["Patente", "N° Tarjetas", "N° Transacciones", "Cantidad (Unidad)", "Monto ($)", "Rendimiento Promedio"])
  fileSeq += 1 // el hash del archivo es el de su contenido: cada llamada necesita uno distinto
  sheet.addRow([movedPlate, 1, 5, 200 + fileSeq, 180000, 3.2])
  sheet.addRow([stayPlate, 1, 4, 150, 120000, 3.1])
  const buffer = await wb.xlsx.writeBuffer()
  const fd = new FormData()
  fd.set("file", new File([buffer as unknown as BlobPart], `${nanoid()}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
  fd.set("worksiteId", "all")
  fd.set("periodoDesde", periodoDesde)
  fd.set("periodoHasta", periodoHasta)
  fd.set("fuente", "Copec")
  const res = await confirmConsumptionImportAction(fd)
  if (!res.ok) throw new Error(res.message)
  return res.data
}

describe("importación «todas las faenas»: la faena es la del período", () => {
  it("un período anterior al traslado archiva al equipo en la faena de origen", async () => {
    const result = await confirmAll("2026-10-01", "2026-10-31")
    expect(result.errors).toEqual([])
    const batches = await inMemoryDb.select().from(schema.fuelImportBatches)
      .where(eq(schema.fuelImportBatches.periodoDesde, "2026-10-01"))
    const byWorksite = new Map(batches.map((b) => [b.worksiteId, b.id]))
    expect([...byWorksite.keys()].sort()).toEqual([wsA, wsB].sort())
    const records = await inMemoryDb.select().from(schema.fuelConsumptionRecords)
    const moved = records.find((r) => r.vehicleId === movedId && r.batchId === byWorksite.get(wsA))
    expect(moved?.worksiteId).toBe(wsA)
  })

  it("un período posterior al traslado lo archiva en la faena nueva", async () => {
    const result = await confirmAll("2026-12-01", "2026-12-31")
    expect(result.errors).toEqual([])
    const records = await inMemoryDb.select().from(schema.fuelConsumptionRecords)
    const mine = records.filter((r) => r.vehicleId === movedId && r.periodoDesde === "2026-12-01")
    expect(mine).toHaveLength(1)
    expect(mine[0]!.worksiteId).toBe(wsB)
  })

  it("un período que cruza el traslado rechaza la fila con el mensaje de importar por faena", async () => {
    const result = await confirmAll("2026-11-10", "2026-11-20")
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.patente).toBe(movedPlate)
    expect(result.errors[0]!.message).toBe("El equipo cambió de faena en el período: impórtalo por faena.")
    const records = await inMemoryDb.select().from(schema.fuelConsumptionRecords)
    expect(records.filter((r) => r.vehicleId === movedId && r.periodoDesde === "2026-11-10")).toHaveLength(0)
    // El equipo que no se movió sí se importa.
    expect(result.imported).toBe(1)
  })
})

describe("vincular patente: acepta al equipo que estuvo en la faena del lote durante el período", () => {
  async function seedBatch(worksiteId: string, periodoDesde: string, periodoHasta: string) {
    const id = nanoid()
    await inMemoryDb.insert(schema.fuelImportBatches).values({
      id, worksiteId, periodoDesde, periodoHasta, fuente: "Otra fuente", hashArchivo: nanoid(),
      archivoNombre: "x.xlsx", archivoPath: "x", importadoPor: "test-user",
    })
    return id
  }
  async function link(batchId: string) {
    const fd = new FormData()
    fd.set("batchId", batchId)
    fd.set("patente", movedPlate)
    fd.set("vehicleId", movedId)
    return linkConsumptionPlateAction({ ok: true, message: "" } as never, fd)
  }

  it("lote de octubre de wsA con el equipo hoy en wsB: se vincula", async () => {
    const res = await link(await seedBatch(wsA, "2026-10-01", "2026-10-31"))
    expect(res.ok).toBe(true)
  })

  it("lote de octubre de wsB: el equipo no estuvo ahí, se rechaza", async () => {
    const res = await link(await seedBatch(wsB, "2026-10-01", "2026-10-31"))
    expect(res.ok).toBe(false)
    expect(res.message).toBe("El vehículo no pertenece a la faena del lote")
  })
})
