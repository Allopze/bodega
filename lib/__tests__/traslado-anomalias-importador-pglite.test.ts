import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import ExcelJS from "exceljs"
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
  requirePermission: async () => ({ user: { id: "test-user", isGlobal: true, worksiteIds: [], permissions: ["combustibles:import"] } }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { syncAnomalyRuleCatalog, getAnomalyCases } = await import("@/lib/combustibles/anomaly-cases")
const { runAllBatchRules } = await import("@/lib/combustibles/anomaly-detector")
const { previewConsumptionImportAction } = await import("@/app/(app)/combustibles/actions-consumos")

const TEST_SESSION = { user: { id: "test-user", isGlobal: true, worksiteIds: [] } } as unknown as import("next-auth").Session

/**
 * Tarea 13 del traslado de equipos entre faenas: los casos de anomalía llevan la faena
 * del evento (no la actual del equipo) y el importador manual reconoce una patente si el
 * equipo estuvo en la faena del lote durante el período del lote.
 *
 * Escenario común: el equipo estuvo en `wsA` hasta el 14-11 y desde el 15-11 está en `wsB`.
 */
const wsA = nanoid()
const wsB = nanoid()
const eqTypeId = nanoid()
const productId = nanoid()
const TRANSFER_DAY = "2026-11-15"

async function seedVehicle(opts: { plate: string; tank?: number }) {
  const id = nanoid()
  await inMemoryDb.insert(schema.fuelVehicles).values({
    id, plate: opts.plate, type: "camion", equipmentTypeId: eqTypeId, worksiteId: wsA,
    meterType: "odometer", isActive: true,
    ...(opts.tank ? { tankCapacityLiters: opts.tank } : {}),
  })
  await setVehicleWorksiteForTest(inMemoryDb as never, id, wsB, TRANSFER_DAY)
  return id
}

beforeAll(async () => {
  await syncAnomalyRuleCatalog()
  await inMemoryDb.insert(schema.worksites).values([
    { id: wsA, name: "Faena A traslado", code: `TA-${nanoid().slice(0, 6)}`, isActive: true },
    { id: wsB, name: "Faena B traslado", code: `TB-${nanoid().slice(0, 6)}`, isActive: true },
  ])
  await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: eqTypeId, slug: `trasl-${nanoid().slice(0, 6)}`, name: "Camión traslado" })
  await inMemoryDb.insert(schema.fuelProducts).values({
    id: productId, code: `DIESEL-TR-${nanoid().slice(0, 6)}`, name: "Diésel traslado", category: "diesel", unit: "liter",
  })
})

describe("importador de consumos: patente reconocida por estadía en el período del lote", () => {
  const plate = `IMP${nanoid().slice(0, 3).toUpperCase()}1`

  beforeAll(async () => {
    await seedVehicle({ plate })
  })

  async function preview(worksiteId: string, periodoDesde: string, periodoHasta: string) {
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet("Consumos")
    sheet.addRow(["Patente", "N° Tarjetas", "N° Transacciones", "Cantidad (Unidad)", "Monto ($)", "Rendimiento Promedio"])
    sheet.addRow([plate, 1, 5, 200, 180000, 3.2])
    const buffer = await wb.xlsx.writeBuffer()
    const fd = new FormData()
    fd.set("file", new File([buffer as unknown as BlobPart], `${nanoid()}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
    fd.set("worksiteId", worksiteId)
    fd.set("periodoDesde", periodoDesde)
    fd.set("periodoHasta", periodoHasta)
    fd.set("fuente", "Copec")
    const res = await previewConsumptionImportAction(fd)
    if (!res.ok) throw new Error(res.message)
    return res.data
  }

  it("reconoce el equipo en el lote de octubre de la faena donde estuvo, aunque hoy esté en otra", async () => {
    const data = await preview(wsA, "2026-10-01", "2026-10-31")
    expect(data.patentesConVehiculo).toBe(1)
    expect(data.patentesSinVehiculo).toBe(0)
  })

  it("reconoce el equipo en un período que cruza el traslado, en ambas faenas", async () => {
    expect((await preview(wsA, "2026-11-10", "2026-11-20")).patentesConVehiculo).toBe(1)
    expect((await preview(wsB, "2026-11-10", "2026-11-20")).patentesConVehiculo).toBe(1)
  })

  it("el último día de la estadía antigua y el primero de la nueva cuentan en su faena", async () => {
    expect((await preview(wsA, "2026-11-14", "2026-11-14")).patentesConVehiculo).toBe(1)
    expect((await preview(wsB, "2026-11-14", "2026-11-14")).patentesConVehiculo).toBe(0)
    expect((await preview(wsB, TRANSFER_DAY, TRANSFER_DAY)).patentesConVehiculo).toBe(1)
    expect((await preview(wsA, TRANSFER_DAY, TRANSFER_DAY)).patentesConVehiculo).toBe(0)
  })

  it("no reconoce el equipo en una faena donde no estuvo durante el período del lote", async () => {
    expect((await preview(wsB, "2026-10-01", "2026-10-31")).patentesConVehiculo).toBe(0)
    expect((await preview(wsA, "2026-11-15", "2026-11-30")).patentesConVehiculo).toBe(0)
  })
})

describe("anomalías: la faena del caso es la del evento, no la actual del equipo", () => {
  it("litros_supera_capacidad sobre un envío TAE de wsA queda en wsA aunque el equipo ya esté en wsB", async () => {
    const vehicleId = await seedVehicle({ plate: `TAE${nanoid().slice(0, 3).toUpperCase()}1`, tank: 200 })
    const submissionId = nanoid()
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: submissionId, clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32),
      worksiteId: wsA, vehicleId, productId, equipmentCodeSnapshot: "TRASL",
      loadedAt: "2026-11-10T15:00:00.000Z", submittedAt: "2026-11-10T15:05:00.000Z",
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      manualIdentity: false, meterType: "odometer", liters: 500, status: "validated",
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submissionId }, TEST_SESSION)
    const found = cases.find((c) => c.ruleCode === "litros_supera_capacidad")
    expect(found).toBeDefined()
    expect(found!.worksiteId).toBe(wsA)
  })

  it("salto_medidor_implausible queda en la faena del equipo el día chileno de la lectura (borde de medianoche)", async () => {
    const vehicleId = await seedVehicle({ plate: `SAL${nanoid().slice(0, 3).toUpperCase()}1` })
    const reading = (over: Partial<typeof schema.fuelMeterReadings.$inferInsert>) => ({
      id: nanoid(), vehicleId, plate: "TEST", source: "copec_tct", sourceRef: nanoid(),
      meterType: "odometer", value: 0, occurredAt: "2026-11-13T15:00:00.000Z", ...over,
    })
    // 2026-11-15T02:30:00Z = 23:30 del 14-11 en Chile: todavía wsA (el traslado rige desde el 15-11).
    const jumpId = nanoid()
    await inMemoryDb.insert(schema.fuelMeterReadings).values([
      reading({ occurredAt: "2026-11-13T15:00:00.000Z", value: 100_000 }),
      reading({ id: jumpId, occurredAt: "2026-11-15T02:30:00.000Z", value: 1_000_000 }),
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "salto_medidor_implausible" }, TEST_SESSION)
    const found = cases.find((c) => c.referenceEntityType === "fuel_meter_reading" && c.referenceEntityId === jumpId)
    expect(found).toBeDefined()
    expect(found!.worksiteId).toBe(wsA)
  })

  it("una lectura del día del traslado queda en la faena nueva", async () => {
    const vehicleId = await seedVehicle({ plate: `SBL${nanoid().slice(0, 3).toUpperCase()}1` })
    const jumpId = nanoid()
    await inMemoryDb.insert(schema.fuelMeterReadings).values([
      { id: nanoid(), vehicleId, plate: "TEST", source: "copec_tct", sourceRef: nanoid(), meterType: "odometer", value: 100_000, occurredAt: "2026-11-15T13:00:00.000Z" },
      { id: jumpId, vehicleId, plate: "TEST", source: "copec_tct", sourceRef: nanoid(), meterType: "odometer", value: 1_000_000, occurredAt: "2026-11-16T13:00:00.000Z" },
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "salto_medidor_implausible" }, TEST_SESSION)
    const found = cases.find((c) => c.referenceEntityType === "fuel_meter_reading" && c.referenceEntityId === jumpId)
    expect(found).toBeDefined()
    expect(found!.worksiteId).toBe(wsB)
  })
})
