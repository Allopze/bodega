import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { nanoid } from "@/lib/id"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

vi.mock("server-only", () => ({}))

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { getFuelCoverageMatrix } = await import("../coverage-matrix-data")

const TODAY = "2026-11-03"
const worksiteId = nanoid()
const otherWorksiteId = nanoid()
const vehicleId = nanoid()

const session = (permissions: string[], scope: { isGlobal: boolean; worksiteIds: string[] }): Session => ({
  user: { id: "u1", name: "Operaciones", email: "o@example.com", roles: ["operaciones"], permissions, primaryWorksiteId: null, avatarColor: null, isActive: true, ...scope },
  expires: "2099-01-01T00:00:00.000Z",
} as unknown as Session)

const admin = session(["combustibles:import", "combustibles:sync_integrations"], { isGlobal: true, worksiteIds: [] })

let seq = 0
const coverage = (channel: "TCT" | "TAE", product: "diesel" | "bluemax", month: string, status: string, rowsAccepted = 0, quantityTotal = 0) => ({
  id: `cov-${++seq}`, provider: "copec", sourceAccount: `${channel.toLowerCase()}:${product}`, channel, product, periodMonth: `${month}-01`,
  status, sourceAvailability: "available", rowsReceived: rowsAccepted, rowsAccepted, quantityTotal,
})
const syncRun = (startedAt: string, status: string) => ({ id: `run-${++seq}`, provider: "onway", trigger: "cron", status, startedAt })

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([
    { id: worksiteId, name: "Cholguán", code: `CH-${nanoid().slice(0, 6)}`, isActive: true },
    { id: otherWorksiteId, name: "Pacífico", code: `PA-${nanoid().slice(0, 6)}`, isActive: true },
  ])
  const typeId = nanoid()
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: typeId, slug: `excavadora-${nanoid().slice(0, 6)}`, name: "Excavadora" })
  await testDb.insert(schema.fuelVehicles).values({
    id: vehicleId, plate: "RKHR20", code: "GR-10", type: "excavadora", equipmentTypeId: typeId, worksiteId, isActive: true, performanceUnit: "liters_per_hour",
  })

  // Copec, como en producción: agosto cerrado, septiembre sin ninguna fila (el hueco del proveedor),
  // octubre con filas pero sin cerrar. El abastecimiento sólo empezó en octubre.
  await testDb.insert(schema.fuelProviderPeriodCoverage).values([
    coverage("TCT", "diesel", "2026-08", "complete", 120, 18_400),
    coverage("TCT", "bluemax", "2026-08", "complete", 8, 640),
    coverage("TCT", "diesel", "2026-10", "incomplete", 90, 12_000),
    coverage("TCT", "bluemax", "2026-10", "unknown"),
    coverage("TAE", "diesel", "2026-10", "incomplete", 5, 900),
  ])

  // Telemetría desde el 1 de julio, todos los días de octubre y sólo el 1 de noviembre.
  const days = [
    ...Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`),
    "2026-07-01", "2026-11-01",
  ]
  await testDb.insert(schema.fuelTelemetryDaily).values(days.map((day) => ({
    id: nanoid(), batchId: null, vehicleId, source: "visionlink-api", day, month: day.slice(0, 7), operatingHours: 8, idleHours: 2, litersWorking: 60, litersIdle: 10,
  })))
  // Lo mismo informado también por Excel el 1 de octubre: no duplica ni el día ni los litros.
  await testDb.insert(schema.fuelTelemetryDaily).values({
    id: nanoid(), batchId: null, vehicleId, source: "visionlink", day: "2026-10-01", month: "2026-10", operatingHours: 8, idleHours: 2, litersWorking: 60, litersIdle: 10,
  })

  // OnWay: una corrida por día de octubre salvo el 30 (caído desde ahí), una «fallida» el 2 de noviembre
  // y una corrida del 1 de noviembre a las 22:30 hora de Chile, que en UTC ya es el 2.
  await testDb.insert(schema.fleetGpsSyncRuns).values([
    ...Array.from({ length: 29 }, (_, index) => syncRun(`2026-10-${String(index + 1).padStart(2, "0")}T15:00:00.000Z`, "success")),
    syncRun("2026-10-31T15:00:00.000Z", "partial"),
    syncRun("2026-11-02T14:00:00.000Z", "failed"),
    syncRun("2026-11-02T01:30:00.000Z", "success"),
  ])
}, 60_000)

const cell = (matrix: Awaited<ReturnType<typeof getFuelCoverageMatrix>>, rowId: string, month: string) => {
  const row = matrix.rows.find((candidate) => candidate.id === rowId)
  return row?.cells[matrix.months.indexOf(month)]
}

describe("getFuelCoverageMatrix", () => {
  it("la ventana son los 12 últimos meses terminando en el mes en curso", async () => {
    const matrix = await getFuelCoverageMatrix(admin, TODAY)
    expect(matrix.months).toHaveLength(12)
    expect(matrix.months[0]).toBe("2025-12")
    expect(matrix.months[11]).toBe("2026-11")
    expect(matrix.rows.map((row) => row.id)).toEqual(["copec-tarjeta", "copec-abastecimiento", "telemetria", "onway"])
    for (const row of matrix.rows) expect(row.cells).toHaveLength(12)
  })

  it("Copec: agosto completo, septiembre un hueco, octubre parcial, noviembre en curso, y antes de empezar no aplica", async () => {
    const matrix = await getFuelCoverageMatrix(admin, TODAY)
    expect(cell(matrix, "copec-tarjeta", "2026-08")).toEqual({ status: "ok", detail: "128 filas, 19.040 L" })
    expect(cell(matrix, "copec-tarjeta", "2026-09")).toEqual({ status: "missing", detail: "sin datos del proveedor" })
    expect(cell(matrix, "copec-tarjeta", "2026-10")).toEqual({ status: "partial", detail: "90 filas, 12.000 L, sin cerrar" })
    expect(cell(matrix, "copec-tarjeta", "2026-11")).toMatchObject({ status: "upcoming" })
    expect(cell(matrix, "copec-tarjeta", "2026-07")).toMatchObject({ status: "na" })
    // El abastecimiento sólo existe desde octubre: agosto no le aplica.
    expect(cell(matrix, "copec-abastecimiento", "2026-08")).toMatchObject({ status: "na" })
    expect(cell(matrix, "copec-abastecimiento", "2026-10")).toMatchObject({ status: "partial" })
  })

  it("telemetría: un solo registro por equipo y día aunque dos fuentes lo informen, y el mes en curso se juzga hasta ayer", async () => {
    const matrix = await getFuelCoverageMatrix(admin, TODAY)
    expect(cell(matrix, "telemetria", "2026-10")).toEqual({ status: "ok", detail: "31 de 31 días con datos, 1 equipo, 2.170 L" })
    expect(cell(matrix, "telemetria", "2026-09")).toEqual({ status: "missing", detail: "0 de 30 días con datos" })
    expect(cell(matrix, "telemetria", "2026-06")).toMatchObject({ status: "na" })
    // 1 de 2 días esperados (el 1 y el 2 de noviembre) con tolerancia 0,9: parcial.
    expect(cell(matrix, "telemetria", "2026-11")).toMatchObject({ status: "partial", detail: expect.stringContaining("1 de 2 días con datos") })
  })

  it("OnWay: cuenta días con una corrida exitosa o parcial, en día civil de Chile; la caída desde el 30 se ve", async () => {
    const matrix = await getFuelCoverageMatrix(admin, TODAY)
    expect(cell(matrix, "onway", "2026-10")).toEqual({ status: "partial", detail: "30 de 31 días con sincronización, 30 corridas" })
    // La del 1 de noviembre a las 22:30 en Chile cae en el 1, no en el 2; la fallida no cuenta.
    expect(cell(matrix, "onway", "2026-11")).toEqual({ status: "partial", detail: "1 de 2 días con sincronización, 1 corrida, hasta ayer" })
    expect(cell(matrix, "onway", "2026-09")).toMatchObject({ status: "na" })
  })

  it("cada fuente respeta su permiso: sin sincronizar no hay Copec ni OnWay; sin importar no hay telemetría", async () => {
    const onlyImport = await getFuelCoverageMatrix(session(["combustibles:import"], { isGlobal: true, worksiteIds: [] }), TODAY)
    expect(onlyImport.rows.map((row) => row.id)).toEqual(["telemetria"])
    const onlySync = await getFuelCoverageMatrix(session(["combustibles:sync_integrations"], { isGlobal: true, worksiteIds: [] }), TODAY)
    expect(onlySync.rows.map((row) => row.id)).toEqual(["copec-tarjeta", "copec-abastecimiento", "onway"])
    const none = await getFuelCoverageMatrix(session(["combustibles:tae_import"], { isGlobal: true, worksiteIds: [] }), TODAY)
    expect(none.rows).toEqual([])
  })

  it("la telemetría se acota a las faenas de la persona: otra faena no ve los equipos de Cholguán", async () => {
    const outside = await getFuelCoverageMatrix(session(["combustibles:import"], { isGlobal: false, worksiteIds: [otherWorksiteId] }), TODAY)
    expect(outside.rows).toEqual([])
    const inside = await getFuelCoverageMatrix(session(["combustibles:import"], { isGlobal: false, worksiteIds: [worksiteId] }), TODAY)
    expect(inside.rows.map((row) => row.id)).toEqual(["telemetria"])
  })
})
