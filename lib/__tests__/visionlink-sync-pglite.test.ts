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
const day = (assetLocalDate: string, runtimeHours: number, idleHours: number) => ({
  assetLocalDate, runtimeHours, idleHours, workingFuelBurnedLiters: runtimeHours * 10, idleFuelBurnedLiters: idleHours * 2, ...NO_CALLOUTS,
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
  const batchId = nanoid()
  const userId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Cholguán", code: `CH-${nanoid().slice(0, 6)}`, isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Importadora", email: `${userId}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: typeId, slug: `excavadora-${nanoid().slice(0, 6)}`, name: "Excavadora" })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: gr10, plate: "RKHR20", code: "GR-10", type: "excavadora", equipmentTypeId: typeId, worksiteId, isActive: true,
      performanceUnit: "liters_per_hour", serialNumber: "DKJ30153",
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
        day("2026-10-23", 10.552, 6.95),
        day("2026-10-24", 7.45, 4.65),
        day("2026-10-25", 1, 2),
        day("2026-10-30", 3, 1),
      ] },
      { equipmentHeader: { make: "CAT", serialNumber: "FDT00314", equipmentId: "TO-37 CH" }, dailyUtilizations: [day("2026-10-23", 1, 0.5)] },
    ])

    const result = await syncVisionLink(credentials, { fetchImpl })

    expect(result).toMatchObject({
      from: "2026-10-16", to: "2026-10-29", assets: 2, matched: 1, inserted: 2, updated: 0,
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

  it("una segunda corrida reescribe los días corregidos sin duplicar", async () => {
    resetVisionLinkTokenCache()
    const { fetchImpl } = api([
      { equipmentHeader: { make: "CAT", serialNumber: "dkj30153" }, dailyUtilizations: [day("2026-10-24", 8, 4), day("2026-10-26", 5, 1)] },
    ])

    const result = await syncVisionLink(credentials, { fetchImpl })
    expect(result).toMatchObject({ inserted: 1, updated: 1, unmatched: [] })

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
