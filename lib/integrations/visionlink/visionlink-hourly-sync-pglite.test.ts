import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import path from "node:path"
import { asc, eq } from "drizzle-orm"
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
  todayInChile: () => "2026-11-19",
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { syncVisionLinkHourly } = await import("./visionlink-hourly-sync")
const { syncVisionLink } = await import("./visionlink-sync")
const { resetVisionLinkTokenCache } = await import("./visionlink-client")
const { logger } = await import("@/lib/logger")

const credentials = { clientId: "id", clientSecret: "secret" }
const NOW = new Date("2026-11-19T15:00:00Z")

type Segment = { startStateUtc: string; endStateUtc: string; durationSeconds: number; segmentType: string }
const segment = (startStateUtc: string, endStateUtc: string, segmentType: string): Segment => ({
  startStateUtc, endStateUtc, segmentType, durationSeconds: (Date.parse(`${endStateUtc}Z`) - Date.parse(`${startStateUtc}Z`)) / 1000,
})

/** API simulada: token, tramos por serie (o un error HTTP) y uso diario sin filas. */
function api(bySerial: Record<string, Segment[] | number>, utilizations: unknown[] = []) {
  const calls: URL[] = []
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    calls.push(url)
    if (url.hostname === "login.microsoftonline.com") return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 })
    if (url.pathname.includes("utilizationHistory")) {
      return new Response(JSON.stringify({ utilizations, responseMetadata: { nextCursor: null } }), { status: 200 })
    }
    const serial = (url.searchParams.get("makeSerialNumbers") ?? "").split("|")[1] ?? ""
    const result = bySerial[serial]
    if (typeof result === "number") return new Response("{}", { status: result })
    const list = result ?? []
    return new Response(JSON.stringify({
      assetOperations: list.length ? [{ equipmentHeader: { serialNumber: serial }, assetOperationDateInfo: list }] : [],
      responseMetadata: {},
    }), { status: 200 })
  })
  return { fetchImpl, calls }
}

async function hourlyRows(vehicleId: string) {
  return inMemoryDb.select().from(schema.fuelTelemetryHourly)
    .where(eq(schema.fuelTelemetryHourly.vehicleId, vehicleId))
    .orderBy(asc(schema.fuelTelemetryHourly.day), asc(schema.fuelTelemetryHourly.hour))
}

async function fetchesOf(vehicleId: string) {
  return inMemoryDb.select().from(schema.fuelTelemetryFetches)
    .where(eq(schema.fuelTelemetryFetches.vehicleId, vehicleId))
    .orderBy(asc(schema.fuelTelemetryFetches.day))
}

describe("syncVisionLinkHourly (PostgreSQL)", () => {
  const worksiteId = nanoid()
  const typeId = nanoid()
  const gr10 = nanoid()
  const cr51 = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Cholguán", code: `CH-${nanoid().slice(0, 6)}`, isActive: true })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: typeId, slug: `excavadora-${nanoid().slice(0, 6)}`, name: "Excavadora" })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: gr10, plate: "RKHR20", code: "GR-10", type: "excavadora", equipmentTypeId: typeId, worksiteId, isActive: true, performanceUnit: "liters_per_hour", serialNumber: "DKJ30153", meterType: "hour_meter" },
      { id: cr51, plate: "CR-51", code: "CR-51", type: "excavadora", equipmentTypeId: typeId, worksiteId, isActive: true, performanceUnit: "liters_per_hour", serialNumber: "M5K05314", meterType: "odometer" },
      // Sin serie: no se consulta.
      { id: nanoid(), plate: "SIN-1", code: "SIN-1", type: "excavadora", equipmentTypeId: typeId, worksiteId, isActive: true, performanceUnit: "liters_per_hour", serialNumber: null, meterType: "odometer" },
    ])
  })

  beforeEach(async () => {
    resetVisionLinkTokenCache()
    await inMemoryDb.delete(schema.fuelTelemetryHourly)
    await inMemoryDb.delete(schema.fuelTelemetryFetches)
    await inMemoryDb.delete(schema.fuelTelemetryDaily)
  })

  const RANGE = { from: "2026-11-18", to: "2026-11-19", now: () => NOW }
  // 08:50–09:20 UTC = 05:50–06:20 en Chile (UTC−3): 10 min a las 05 y 20 a las 06.
  const MORNING = [
    segment("2026-11-18T08:50:00", "2026-11-18T09:20:00", "idle"),
    segment("2026-11-18T09:20:00", "2026-11-18T10:00:00", "working"),
    segment("2026-11-18T09:00:00", "2026-11-18T10:00:00", "running"),
  ]

  it("reparte los tramos por hora local y guarda la constancia de cada día del rango", async () => {
    const { fetchImpl, calls } = api({ DKJ30153: MORNING, M5K05314: [] })
    const result = await syncVisionLinkHourly(credentials, { ...RANGE, fetchImpl })

    expect(result).toMatchObject({ from: "2026-11-18", to: "2026-11-19", vehicles: 2, segments: 3, hoursWritten: 2, failedVehicles: [] })
    expect(await hourlyRows(gr10)).toEqual([
      expect.objectContaining({ day: "2026-11-18", hour: 5, source: "visionlink-api", idleSeconds: 600, workingSeconds: 0, runningSeconds: 0 }),
      expect.objectContaining({ day: "2026-11-18", hour: 6, source: "visionlink-api", idleSeconds: 1200, workingSeconds: 2400, runningSeconds: 3600 }),
    ])
    // Constancia para cada día del rango, también para el equipo sin tramos y para un día sin ellos.
    for (const id of [gr10, cr51]) {
      expect((await fetchesOf(id)).map((row) => [row.day, row.segmentsFetchedAt !== null, row.dailyFetchedAt])).toEqual([
        ["2026-11-18", true, null],
        ["2026-11-19", true, null],
      ])
    }
    expect(await hourlyRows(cr51)).toEqual([])
    // Una consulta por equipo con serie (el rango, con un día de margen a cada lado sin pasar de hoy, cabe en una ventana) y con la marca CAT.
    const queried = calls.filter((url) => url.pathname.includes("assetOperations"))
    expect(queried.map((url) => url.searchParams.get("makeSerialNumbers")).sort()).toEqual(["CAT|DKJ30153", "CAT|M5K05314"])
    expect(queried[0]!.searchParams.get("startDate")).toBe("2026-11-17")
    expect(queried[0]!.searchParams.get("endDate")).toBe("2026-11-19")
  })

  it("correrlo dos veces deja las mismas filas", async () => {
    const { fetchImpl } = api({ DKJ30153: MORNING })
    await syncVisionLinkHourly(credentials, { ...RANGE, fetchImpl })
    const first = (await hourlyRows(gr10)).map(({ updatedAt: _updatedAt, ...row }) => row)
    await syncVisionLinkHourly(credentials, { ...RANGE, fetchImpl })
    const second = (await hourlyRows(gr10)).map(({ updatedAt: _updatedAt, ...row }) => row)
    expect(second).toEqual(first)
    expect(second).toHaveLength(2)
    expect(await fetchesOf(gr10)).toHaveLength(2)
  })

  it("una segunda corrida sin tramos para una hora la deja en cero", async () => {
    await syncVisionLinkHourly(credentials, { ...RANGE, fetchImpl: api({ DKJ30153: MORNING }).fetchImpl })
    expect(await hourlyRows(gr10)).toHaveLength(2)

    // VisionLink corrigió: ya no hay nada antes de las 06 y el ralentí de las 06 bajó.
    const corrected = [segment("2026-11-18T09:00:00", "2026-11-18T09:10:00", "idle")]
    await syncVisionLinkHourly(credentials, { ...RANGE, fetchImpl: api({ DKJ30153: corrected }).fetchImpl })
    expect(await hourlyRows(gr10)).toEqual([
      expect.objectContaining({ day: "2026-11-18", hour: 6, idleSeconds: 600, workingSeconds: 0, runningSeconds: 0 }),
    ])
  })

  it("no toca las horas fuera del rango reescrito", async () => {
    await syncVisionLinkHourly(credentials, { from: "2026-11-18", to: "2026-11-18", now: () => NOW, fetchImpl: api({ DKJ30153: MORNING }).fetchImpl })
    await syncVisionLinkHourly(credentials, { from: "2026-11-19", to: "2026-11-19", now: () => NOW, fetchImpl: api({ DKJ30153: [] }).fetchImpl })
    expect(await hourlyRows(gr10)).toHaveLength(2)
  })

  it("si un equipo falla, los demás se guardan y el fallo queda en failedVehicles", async () => {
    const { fetchImpl } = api({ DKJ30153: MORNING, M5K05314: 500 })
    const result = await syncVisionLinkHourly(credentials, { ...RANGE, fetchImpl })
    expect(result.failedVehicles).toEqual([{ vehicleCode: "CR-51", errorCode: "VISIONLINK_HTTP_ERROR" }])
    expect(await hourlyRows(gr10)).toHaveLength(2)
    expect(await fetchesOf(gr10)).toHaveLength(2)
    // El equipo que falló no deja constancia: sus horas no pasan por «conocidas».
    expect(await fetchesOf(cr51)).toEqual([])
  })

  it("registra un tramo de tipo desconocido en el log y no lo suma", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
    const odd = [segment("2026-11-18T09:00:00", "2026-11-18T09:30:00", "idle"), segment("2026-11-18T09:30:00", "2026-11-18T10:00:00", "parked")]
    await syncVisionLinkHourly(credentials, { ...RANGE, fetchImpl: api({ DKJ30153: odd }).fetchImpl })
    expect(await hourlyRows(gr10)).toEqual([expect.objectContaining({ hour: 6, idleSeconds: 1800, workingSeconds: 0, runningSeconds: 0 })])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("tipo de tramo"), expect.objectContaining({ segmentType: "parked" }))
    warn.mockRestore()
  })

  it("descarta las horas de un tramo que caen fuera del rango pedido", async () => {
    // 02:30–03:30 UTC del 19 = 23:30 del 18 a 00:30 del 19 en Chile (UTC−3); el rango es sólo el 19.
    const night = [segment("2026-11-19T02:30:00", "2026-11-19T03:30:00", "working")]
    await syncVisionLinkHourly(credentials, { from: "2026-11-19", to: "2026-11-19", now: () => NOW, fetchImpl: api({ DKJ30153: night }).fetchImpl })
    expect(await hourlyRows(gr10)).toEqual([expect.objectContaining({ day: "2026-11-19", hour: 0, workingSeconds: 1800 })])
  })

  it("el sync diario marca daily_fetched_at aunque VisionLink no devuelva fila para un equipo", async () => {
    // VisionLink no informa a ningún equipo en esos días (no transmitieron).
    const { fetchImpl } = api({}, [])
    await syncVisionLink(credentials, { from: "2026-11-16", to: "2026-11-17", fetchImpl })
    for (const id of [gr10, cr51]) {
      const rows = await fetchesOf(id)
      expect(rows.map((row) => row.day)).toEqual(["2026-11-16", "2026-11-17"])
      expect(rows.every((row) => row.dailyFetchedAt !== null)).toBe(true)
      expect(rows.every((row) => row.segmentsFetchedAt === null)).toBe(true)
    }
  })

  it("el sync diario no pisa la constancia de tramos del mismo día", async () => {
    await syncVisionLinkHourly(credentials, { from: "2026-11-18", to: "2026-11-18", now: () => NOW, fetchImpl: api({ DKJ30153: [] }).fetchImpl })
    await syncVisionLink(credentials, { from: "2026-11-18", to: "2026-11-18", fetchImpl: api({}).fetchImpl })
    const [row] = await fetchesOf(gr10)
    expect(row!.segmentsFetchedAt).not.toBeNull()
    expect(row!.dailyFetchedAt).not.toBeNull()
  })
})
