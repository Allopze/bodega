import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { COPEC_COVERAGE_ACCOUNTS } from "@/lib/combustibles/copec-coverage"
import { IDS, scopedSession, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = db
vi.mock("@/db", () => ({ get db() { return g.__db } }))
// `can()` real arrastra next-auth y next/headers; sólo se necesita el chequeo de permisos de la sesión.
vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission as never) ?? false,
}))

const { getFuelProviderCoverageGaps } = await import("../coverage-notice-data")

/**
 * CHART-022, aviso de cobertura de los gráficos de combustible: qué meses de la ventana de un
 * gráfico no tienen datos del proveedor o están incompletos. Es la misma vara que Analítica,
 * el tablero y Flota (`monthsWithoutProviderData`); estas pruebas fijan que el aviso no discrepe
 * de ellos y que respete el alcance de faena de quien mira.
 */
const TODAY = "2026-11-03"
const WINDOW = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]
const FUEL_SUPPLIER = "fs-copec-notice"

const sessionWith = (permissions: string[], overrides: Partial<{ isGlobal: boolean; worksiteIds: string[] }> = {}): Session => {
  const base = scopedSession(overrides.worksiteIds ?? [])
  return { ...base, user: { ...base.user, isGlobal: overrides.isGlobal ?? true, permissions } } as unknown as Session
}
const viewer = sessionWith(["combustibles:view"])

let seq = 0
const tx = (month: string, overrides: Partial<typeof schema.fuelProviderTransactions.$inferInsert> = {}): typeof schema.fuelProviderTransactions.$inferInsert => {
  seq += 1
  return {
    id: `cn-${seq}`, syncRunId: IDS.run, provider: "copec", sourceAccount: "tct:diesel", identityKey: `cn-idk-${seq}`,
    fingerprint: `cn-fp-${seq}`, sourceRowKey: `cn-row-${seq}`, payloadHash: `cn-ph-${seq}`,
    supplierId: FUEL_SUPPLIER, worksiteId: IDS.wsA, vehicleId: IDS.vA, sourcePlate: "AA-0001",
    occurredAt: `${month}-10T12:00:00.000Z`, quantity: 100, amount: 100_000, status: "accepted", granularity: "transaction",
    ...overrides,
  }
}

async function closeMonth(month: string) {
  await db.insert(schema.fuelProviderPeriodCoverage).values(COPEC_COVERAGE_ACCOUNTS.map((account) => {
    const [channel = "tct", product = "diesel"] = account.split(":")
    return {
      id: `cn-cov-${month}-${account}`, provider: "copec", sourceAccount: account, channel: channel.toUpperCase(), product,
      periodMonth: `${month}-01`, status: "complete", rowsAccepted: 0, rowsReceived: 0,
    }
  }))
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(db)
  await db.insert(schema.fuelSuppliers).values({ id: FUEL_SUPPLIER, name: "Copec de prueba" })
  await db.insert(schema.fuelProviderSyncRuns).values({ id: IDS.run, provider: "copec", requestedFrom: "2026-06-01", requestedTo: "2026-11-30", correlationId: "corr-coverage-notice" })
  await db.insert(schema.fuelProviderTransactions).values([
    tx("2026-06"), // con filas de la faena A
    tx("2026-07", { worksiteId: IDS.wsB, vehicleId: IDS.vB }), // sólo la faena B tiene filas
    tx("2026-10"), // con filas
    tx("2026-11"), // el mes en curso, con datos
  ])
  // Agosto: el proveedor cerró el mes sin movimientos (vacío certificado: no es hueco). Septiembre: nada.
  await closeMonth("2026-08")
})

describe("getFuelProviderCoverageGaps", () => {
  it("un mes sin transacciones ni cobertura es un hueco; el cerrado sin movimientos y el que tiene filas, no", async () => {
    const result = await getFuelProviderCoverageGaps(viewer, WINDOW, { today: TODAY })

    expect(result.gapMonths).toEqual(["2026-09"])
  })

  it("el mes en curso con datos es parcial; el que ya es hueco no se repite como parcial", async () => {
    expect((await getFuelProviderCoverageGaps(viewer, WINDOW, { today: TODAY })).partialMonths).toEqual(["2026-11"])

    // Sin filas de noviembre: es un hueco y desaparece de los parciales.
    const onlyEmptyCurrent = await getFuelProviderCoverageGaps(viewer, ["2026-09", "2026-12"], { today: "2026-12-03" })
    expect(onlyEmptyCurrent.gapMonths).toEqual(["2026-09", "2026-12"])
    expect(onlyEmptyCurrent.partialMonths).toEqual([])
  })

  it("el último día del mes ya no es parcial (misma regla que la columna tenue del gráfico)", async () => {
    expect((await getFuelProviderCoverageGaps(viewer, WINDOW, { today: "2026-11-30" })).partialMonths).toEqual([])
  })

  it("respeta el alcance de faena: los meses «con filas» son los de lo que esa persona puede ver", async () => {
    // Julio sólo tiene filas de la faena B: para quien sólo ve la A es un hueco; para el global, no.
    const scopedA = await getFuelProviderCoverageGaps(sessionWith(["combustibles:view"], { isGlobal: false, worksiteIds: [IDS.wsA] }), WINDOW, { today: TODAY })
    expect(scopedA.gapMonths).toEqual(["2026-07", "2026-09"])

    const chosenB = await getFuelProviderCoverageGaps(viewer, WINDOW, { today: TODAY, worksiteId: IDS.wsB })
    expect(chosenB.gapMonths).toEqual(["2026-06", "2026-09", "2026-10", "2026-11"])
  })

  it("`fromDate` deja fuera las filas anteriores al corte: la ventana de Flota parte a mitad de mes", async () => {
    const result = await getFuelProviderCoverageGaps(viewer, ["2026-06", "2026-10"], { today: TODAY, fromDate: "2026-06-15" })

    // Las filas de junio son del día 10: antes del corte, no respaldan las cifras de la ventana.
    expect(result.gapMonths).toEqual(["2026-06"])
  })

  it("sin combustibles:view o sin meses no hay nada que advertir", async () => {
    expect(await getFuelProviderCoverageGaps(sessionWith(["flota:view"]), WINDOW, { today: TODAY })).toEqual({ gapMonths: [], partialMonths: [] })
    expect(await getFuelProviderCoverageGaps(viewer, [], { today: TODAY })).toEqual({ gapMonths: [], partialMonths: [] })
  })

  it("acepta los meses desordenados o repetidos", async () => {
    const result = await getFuelProviderCoverageGaps(viewer, ["2026-10", "2026-09", "2026-09"], { today: TODAY })

    expect(result.gapMonths).toEqual(["2026-09"])
  })
})
