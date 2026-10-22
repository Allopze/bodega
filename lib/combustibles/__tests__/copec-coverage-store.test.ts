import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js result types differ.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
const { recordCopecPeriodCoverage } = await import("../copec-coverage-store")
await inMemoryDb.insert(schema.users).values({ id: "operator-1", name: "Auditor", email: "auditor@chome.test", hashedPassword: "not-used" })

describe("persistencia de cobertura Copec", () => {
  it("preserva la procedencia de un mes cerrado cuando una consulta posterior no entrega archivo", async () => {
    const key = { provider: "copec", sourceAccount: "tct:diesel", channel: "TCT", product: "diesel", periodMonth: "2018-01-01" }
    await recordCopecPeriodCoverage({
      channel: "TCT", product: "diesel", month: key.periodMonth,
      status: "complete", sourceAvailability: "available", rowsReceived: 12,
      rowsAccepted: 12, quantityTotal: 85.125, amountTotal: 170250,
    })
    await recordCopecPeriodCoverage({
      channel: "TCT", product: "diesel", month: key.periodMonth,
      status: "unknown", sourceAvailability: "unavailable",
    })

    const [row] = await inMemoryDb.select().from(schema.fuelProviderPeriodCoverage)
      .where(and(
        eq(schema.fuelProviderPeriodCoverage.provider, key.provider),
        eq(schema.fuelProviderPeriodCoverage.sourceAccount, key.sourceAccount),
        eq(schema.fuelProviderPeriodCoverage.periodMonth, key.periodMonth),
      ))
    expect(row).toMatchObject({
      status: "complete",
      sourceAvailability: "available",
      rowsReceived: 12,
      rowsAccepted: 12,
      quantityTotal: 85.125,
      amountTotal: 170250,
    })
  })

  it("rechaza cerrar un período vacío sin evidencia y operador", async () => {
    await expect(recordCopecPeriodCoverage({
      channel: "TAE", product: "bluemax", month: "2018-02-01",
      status: "legitimate_empty", sourceAvailability: "available",
    })).rejects.toThrow(/evidencia y operador/)
  })

  it("no reemplaza una cobertura completa por una confirmación vacía concurrente", async () => {
    const month = "2018-03-01"
    await recordCopecPeriodCoverage({
      channel: "TAE", product: "diesel", month,
      status: "complete", sourceAvailability: "available", rowsReceived: 7,
      rowsAccepted: 7, quantityTotal: 41.25, amountTotal: 92000,
    })
    await recordCopecPeriodCoverage({
      channel: "TAE", product: "diesel", month,
      status: "legitimate_empty", sourceAvailability: "available",
      evidence: "Portal revisado: el reporte descargado no contiene operaciones",
      evidenceActorUserId: "operator-1",
    })

    const [row] = await inMemoryDb.select().from(schema.fuelProviderPeriodCoverage)
      .where(and(
        eq(schema.fuelProviderPeriodCoverage.provider, "copec"),
        eq(schema.fuelProviderPeriodCoverage.sourceAccount, "tae:diesel"),
        eq(schema.fuelProviderPeriodCoverage.periodMonth, month),
      ))
    expect(row).toMatchObject({ status: "complete", rowsReceived: 7, rowsAccepted: 7, quantityTotal: 41.25, amountTotal: 92000 })
  })

  it("una descarga fallida no degrada un mes verificado, pero un archivo rechazado sí lo reabre", async () => {
    const month = "2018-04-01"
    const read = async () => (await inMemoryDb.select().from(schema.fuelProviderPeriodCoverage)
      .where(and(
        eq(schema.fuelProviderPeriodCoverage.provider, "copec"),
        eq(schema.fuelProviderPeriodCoverage.sourceAccount, "tct:bluemax"),
        eq(schema.fuelProviderPeriodCoverage.periodMonth, month),
      )))[0]
    await recordCopecPeriodCoverage({
      channel: "TCT", product: "bluemax", month,
      status: "complete", sourceAvailability: "available", rowsReceived: 4, rowsAccepted: 4,
    })

    // Red, sesión o selector: no dice nada sobre los datos del mes.
    await recordCopecPeriodCoverage({ channel: "TCT", product: "bluemax", month, status: "failed", sourceAvailability: "unknown" })
    expect(await read()).toMatchObject({ status: "complete", rowsReceived: 4 })

    // Un archivo que sí llegó y se rechazó es evidencia nueva.
    await recordCopecPeriodCoverage({ channel: "TCT", product: "bluemax", month, status: "failed", sourceAvailability: "available", rowsReceived: 4, rowsRejected: 1 })
    expect(await read()).toMatchObject({ status: "failed", rowsRejected: 1 })
  })
})
