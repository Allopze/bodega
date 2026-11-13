import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import { and, eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  todayInChile: () => "2026-10-30",
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { syncVisionLink, VISIONLINK_API_SOURCE } = await import("@/lib/integrations/visionlink/visionlink-sync")
const { resetVisionLinkTokenCache } = await import("@/lib/integrations/visionlink/visionlink-client")

const NO_CALLOUTS = { hourCallouts: { runtimeHours: null, idleHours: null }, fuelCallouts: { idleFuelBurned: null, workingFuelBurned: null } }
const day = (assetLocalDate: string, runtimeHours: number, idleHours: number, hourMeter?: number | null, hourMeterCallout: string | null = null) => ({
  assetLocalDate, runtimeHours, idleHours, workingFuelBurnedLiters: runtimeHours * 10, idleFuelBurnedLiters: idleHours * 2,
  ...(hourMeter === undefined ? {} : { hourMeter }),
  ...NO_CALLOUTS,
  ...(hourMeter === undefined ? {} : { hourCallouts: { ...NO_CALLOUTS.hourCallouts, hourMeter: hourMeterCallout } }),
})

/** API simulada: token y una sola página con lo que se le pase. */
function api(utilizations: unknown[]) {
  const calls: URL[] = []
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    calls.push(url)
    const body = url.hostname === "login.microsoftonline.com"
      ? { access_token: "t", expires_in: 3600 }
      : { utilizations, responseMetadata: { nextCursor: null } }
    return new Response(JSON.stringify(body), { status: 200 })
  })
  return { fetchImpl, calls }
}

const credentials = { clientId: "id", clientSecret: "secret" }

/** Sincronización VisionLink contra PostgreSQL: cruce por serie, upsert, fuentes separadas. */
describe("syncVisionLink (PostgreSQL)", () => {
  const worksiteId = nanoid()
  const typeId = nanoid()
  const gr10 = nanoid()
  const cr51 = nanoid()
  const batchId = nanoid()
  const userId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Cholguán", code: `CH-${nanoid().slice(0, 6)}`, isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Importadora", email: `${userId}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: typeId, slug: `excavadora-${nanoid().slice(0, 6)}`, name: "Excavadora" })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: gr10, plate: "RKHR20", code: "GR-10", type: "excavadora", equipmentTypeId: typeId, worksiteId, isActive: true,
      performanceUnit: "liters_per_hour", serialNumber: "DKJ30153", meterType: "hour_meter",
    })
    // Camión con odómetro: el horómetro de VisionLink no le corresponde.
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: cr51, plate: "CR-51", code: "CR-51", type: "excavadora", equipmentTypeId: typeId, worksiteId, isActive: true,
      performanceUnit: "liters_per_hour", serialNumber: "M5K05314", meterType: "odometer",
    })
    // Un día ya importado a mano desde Excel (fuente «visionlink», con lote).
    await inMemoryDb.insert(schema.fuelControlImportBatches).values({ id: batchId, kind: "telemetry", fileName: "vl.xlsx", fileHash: "h", importedBy: userId })
    await inMemoryDb.insert(schema.fuelTelemetryDaily).values({
      id: nanoid(), batchId, vehicleId: gr10, source: "visionlink", day: "2026-10-23", month: "2026-10", operatingHours: 9, idleHours: 6,
    })
  })

  it("inserta por serie, descarta lo inválido y devuelve los equipos sin vínculo", async () => {
    resetVisionLinkTokenCache()
    const { fetchImpl, calls } = api([
      { equipmentHeader: { make: "CAT", serialNumber: "DKJ30153", equipmentId: "GR-10 CH" }, dailyUtilizations: [
        day("2026-10-23", 10.552, 6.95, 8000.5),
        day("2026-10-24", 7.45, 4.65, 8008),
        day("2026-10-25", 1, 2, 8009, "Invalid value detected in date range"),
        day("2026-10-30", 3, 1, 8012),
      ] },
      { equipmentHeader: { make: "CAT", serialNumber: "M5K05314" }, dailyUtilizations: [day("2026-10-24", 5, 1, 12000)] },
      { equipmentHeader: { make: "CAT", serialNumber: "FDT00314", equipmentId: "TO-37 CH" }, dailyUtilizations: [day("2026-10-23", 1, 0.5)] },
    ])

    const result = await syncVisionLink(credentials, { fetchImpl })

    expect(result).toMatchObject({
      from: "2026-10-16", to: "2026-10-29", assets: 3, matched: 2, inserted: 3, updated: 0, meterReadingsSaved: 2,
      skippedDays: { idle_over_runtime: 1, future_day: 1 },
      unmatched: [{ serialNumber: "FDT00314", equipmentId: "TO-37 CH" }],
    })
    const page = calls.find((url) => url.hostname === "services.cat.com")!
    expect(page.searchParams.get("startDate")).toBe("2026-10-16")
    expect(page.searchParams.get("endDate")).toBe("2026-10-29")

    const rows = await inMemoryDb.select().from(schema.fuelTelemetryDaily)
      .where(and(eq(schema.fuelTelemetryDaily.vehicleId, gr10), eq(schema.fuelTelemetryDaily.source, VISIONLINK_API_SOURCE)))
      .orderBy(schema.fuelTelemetryDaily.day)
    expect(rows.map((row) => [row.day, row.month, row.operatingHours, row.idleHours, row.litersWorking, row.litersIdle, row.batchId])).toEqual([
      ["2026-10-23", "2026-10", 10.55, 6.95, 105.52, 13.9, null],
      ["2026-10-24", "2026-10", 7.45, 4.65, 74.5, 9.3, null],
    ])
  })

  it("guarda el horómetro acumulado como lectura visionlink_api sólo de equipos con horómetro", async () => {
    const readings = await inMemoryDb.select().from(schema.fuelMeterReadings)
      .where(eq(schema.fuelMeterReadings.source, "visionlink_api"))
      .orderBy(schema.fuelMeterReadings.occurredAt)
    // 10-25 trae callout, 10-30 está en curso y el camión con odómetro no entra.
    expect(readings.map((row) => [row.vehicleId, row.plate, row.sourceRef, row.occurredAt, row.meterType, row.value, row.liters])).toEqual([
      [gr10, "RKHR20", "visionlink:DKJ30153:2026-10-23", "2026-10-24T02:59:59.000Z", "hour_meter", 8000.5, null],
      [gr10, "RKHR20", "visionlink:DKJ30153:2026-10-24", "2026-10-25T02:59:59.000Z", "hour_meter", 8008, null],
    ])
    expect(readings[0]!.rawPayload).toEqual({ provider: "visionlink", serialNumber: "DKJ30153", day: "2026-10-23" })
  })

  it("una segunda corrida reescribe los días corregidos sin duplicar", async () => {
    resetVisionLinkTokenCache()
    const { fetchImpl } = api([
      { equipmentHeader: { make: "CAT", serialNumber: "dkj30153" }, dailyUtilizations: [day("2026-10-24", 8, 4, 8008.25), day("2026-10-26", 5, 1, 8020)] },
    ])

    const result = await syncVisionLink(credentials, { fetchImpl })
    expect(result).toMatchObject({ inserted: 1, updated: 1, unmatched: [], meterReadingsSaved: 2 })
    const readings = await inMemoryDb.select().from(schema.fuelMeterReadings)
      .where(and(eq(schema.fuelMeterReadings.vehicleId, gr10), eq(schema.fuelMeterReadings.source, "visionlink_api")))
      .orderBy(schema.fuelMeterReadings.occurredAt)
    expect(readings.map((row) => [row.sourceRef, row.value])).toEqual([
      ["visionlink:DKJ30153:2026-10-23", 8000.5],
      ["visionlink:DKJ30153:2026-10-24", 8008.25],
      ["visionlink:DKJ30153:2026-10-26", 8020],
    ])

    const rows = await inMemoryDb.select().from(schema.fuelTelemetryDaily)
      .where(and(eq(schema.fuelTelemetryDaily.vehicleId, gr10), eq(schema.fuelTelemetryDaily.source, VISIONLINK_API_SOURCE)))
      .orderBy(schema.fuelTelemetryDaily.day)
    expect(rows.map((row) => [row.day, row.operatingHours])).toEqual([["2026-10-23", 10.55], ["2026-10-24", 8], ["2026-10-26", 5]])
  })

  it("no toca la fila importada a mano el mismo día", async () => {
    const [manual] = await inMemoryDb.select().from(schema.fuelTelemetryDaily)
      .where(and(eq(schema.fuelTelemetryDaily.vehicleId, gr10), eq(schema.fuelTelemetryDaily.source, "visionlink")))
    expect(manual).toMatchObject({ day: "2026-10-23", operatingHours: 9, idleHours: 6, batchId })
  })
})
