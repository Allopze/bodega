import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, inArray, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
// `can()` real arrastra next-auth y next/headers; sólo se necesita el chequeo de permisos de la sesión.
vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission as never) ?? false,
}))

const { getFleetOverview, getFleetOverviewPage } = await import("@/lib/services/fleet")
const { accountableProviderTransactionsWhere } = await import("@/lib/combustibles/load-status")

/**
 * C-9, tercera parte: la lista de Flota («Costo combustible (12 meses)», «Litros
 * registrados (12 meses)», la columna «Combustible» y la exportación) leía
 * `fuel_loads`, vacía en producción. Ahora suma el libro del proveedor con la
 * regla canónica compartida, igual que Analítica.
 *
 * Los datos se siembran en el mes en curso (días ≤ 15) para que la ventana móvil
 * de 12 meses no los suelte con el paso del tiempo.
 */
const { year: YEAR, month: MONTH_NUMBER } = chileDateParts()
const MONTH = `${YEAR}-${String(MONTH_NUMBER).padStart(2, "0")}`
const dayOf = (day: number) => `${MONTH}-${String(day).padStart(2, "0")}T12:00:00.000Z`
/** Hace 14 meses: fuera de la ventana de 12. */
const OLD = (() => {
  const date = new Date(Date.UTC(YEAR, MONTH_NUMBER - 1 - 14, 10, 12))
  return date.toISOString()
})()

const FUEL_SUPPLIER = "fs-copec-fleet"

function session(overrides: { worksiteIds?: string[]; isGlobal?: boolean; permissions?: string[] } = {}): Session {
  return {
    user: {
      id: IDS.user,
      isGlobal: overrides.isGlobal ?? true,
      roles: [],
      worksiteIds: overrides.worksiteIds ?? [],
      permissions: overrides.permissions ?? ["flota:view", "combustibles:view", "combustibles:view_costs"],
    },
    expires: "2099-01-01",
  } as unknown as Session
}

let counter = 0
function tx(overrides: Partial<typeof schema.fuelProviderTransactions.$inferInsert>): typeof schema.fuelProviderTransactions.$inferInsert {
  counter += 1
  return {
    id: `fft-${counter}`, syncRunId: IDS.run, provider: "copec", sourceAccount: "tct:diesel", identityKey: `fft-idk-${counter}`,
    fingerprint: `fft-fp-${counter}`, sourceRowKey: `fft-row-${counter}`, payloadHash: `fft-ph-${counter}`,
    supplierId: FUEL_SUPPLIER, worksiteId: IDS.wsA, vehicleId: IDS.vA, sourcePlate: "AA-0001",
    occurredAt: dayOf(10), quantity: 100, amount: 100_000, status: "accepted", granularity: "transaction",
    ...overrides,
  }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await pg.exec("SET TIME ZONE 'UTC'")
  await seedControlFixtures(db)
  await db.insert(schema.fuelSuppliers).values({ id: FUEL_SUPPLIER, name: "Copec de prueba" })
  await db.insert(schema.fuelProviderSyncRuns).values({ id: IDS.run, provider: "copec", requestedFrom: `${MONTH}-01`, requestedTo: `${MONTH}-28`, correlationId: "corr-fleet-fuel" })
  await db.insert(schema.fuelProviderTransactions).values([
    // Vehículo A: dos transacciones y el agregado TCT del mismo mes (el MISMO litro a otro nivel: no cuenta).
    tx({ id: "a-1", quantity: 100, amount: 100_000, occurredAt: dayOf(10) }),
    tx({ id: "a-2", quantity: 50, amount: 60_000, occurredAt: dayOf(12) }),
    tx({ id: "a-agg", granularity: "period_aggregate", quantity: 150, amount: 160_000, occurredAt: `${MONTH}-01` }),
    // Lo que no es consumo: pendiente, excluida, rechazada; y una reemplazada por su vigente.
    tx({ id: "a-pending", status: "pending", quantity: 9_999, amount: 999_999, occurredAt: dayOf(11) }),
    tx({ id: "a-excluded", status: "excluded", quantity: 8_888, amount: 888_888, occurredAt: dayOf(11) }),
    tx({ id: "a-rejected", status: "rejected", quantity: 7_777, amount: 777_777, occurredAt: dayOf(11) }),
    tx({ id: "a-old", quantity: 11, amount: 1_100, occurredAt: dayOf(13) }),
    tx({ id: "a-new", quantity: 12, amount: 1_200, occurredAt: dayOf(13), supersedesId: "a-old" }),
    // Fuera de la ventana de 12 meses.
    tx({ id: "a-ancient", quantity: 5_000, amount: 5_000_000, occurredAt: OLD }),
    // Vehículo B: agregado TCT SIN detalle del mes; representa las 3 cargas de su `detalle`.
    tx({
      id: "b-agg", granularity: "period_aggregate", worksiteId: IDS.wsB, vehicleId: IDS.vB, sourcePlate: "BB-0002",
      quantity: 70, amount: 80_000, occurredAt: `${MONTH}-01`, rawPayload: { detalle: [{ n: 1 }, { n: 2 }, { n: 3 }] },
    }),
    // Vehículo C: una carga cuya faena es OTRA (la de A): el alcance se aplica a la faena de la transacción.
    tx({ id: "c-1", vehicleId: IDS.vC, sourcePlate: "CC-0003", worksiteId: IDS.wsA, quantity: 33, amount: 33_000, occurredAt: dayOf(14) }),
    // Recepción en estanque (TAE) sin vehículo: no es de ningún vehículo y no entra a la lista de flota.
    tx({ id: "tae-1", sourceAccount: "tae:diesel", vehicleId: null, sourcePlate: null, quantity: 1_000, amount: 1_200_000, occurredAt: dayOf(15) }),
  ])
  // La serie facturada es OTRO concepto: una carga de fuel_loads no debe sumarse a la de la flota.
  await db.insert(schema.fuelLoads).values({
    id: "fl-a", loadDate: `${MONTH}-10`, month: MONTH, serviceType: "TCT", vehicleId: IDS.vA, fuelSupplierId: FUEL_SUPPLIER,
    worksiteId: IDS.wsA, product: "PETROLEO DIESEL", productId: IDS.product, liters: 999, baseAmount: 999_000, totalAmount: 999_000,
    status: "registered", createdBy: IDS.user,
  })
}, 60_000)

afterAll(async () => { await pg.close() })

const rowOf = (rows: Awaited<ReturnType<typeof getFleetOverview>>, id: string) => rows.find((row) => row.id === id)!

describe("getFleetOverview · combustible por vehículo desde el libro del proveedor (C-9)", () => {
  it("suma litros, costo y cargas por vehículo bajo la regla canónica", async () => {
    const rows = await getFleetOverview(session())

    // A: 100 + 50 + la vigente (12); sin agregado, pendiente, excluida, rechazada, reemplazada ni la de hace 14 meses.
    expect(rowOf(rows, IDS.vA)).toMatchObject({ totalLiters: 162, totalFuelAmount: 161_200, loadCount: 3 })
    // B: el agregado sin detalle cuenta, y vale las 3 cargas de su `detalle`.
    expect(rowOf(rows, IDS.vB)).toMatchObject({ totalLiters: 70, totalFuelAmount: 80_000, loadCount: 3 })
  })

  it("coincide con la suma de la regla compartida (accountableProviderTransactionsWhere) por vehículo", async () => {
    const rows = await getFleetOverview(session())
    const since = new Date(Date.UTC(YEAR, MONTH_NUMBER - 1 - 12, 1)).toISOString().slice(0, 10)
    const canonical = await db.select({
      vehicleId: schema.fuelProviderTransactions.vehicleId,
      liters: sql<number>`coalesce(sum(${schema.fuelProviderTransactions.quantity}), 0)`,
      amount: sql<number>`coalesce(sum(${schema.fuelProviderTransactions.amount}), 0)`,
    }).from(schema.fuelProviderTransactions)
      .where(and(accountableProviderTransactionsWhere(), inArray(schema.fuelProviderTransactions.vehicleId, [IDS.vA, IDS.vB]), sql`left(${schema.fuelProviderTransactions.occurredAt}, 10) >= ${since}`))
      .groupBy(schema.fuelProviderTransactions.vehicleId)

    expect(canonical).toHaveLength(2)
    for (const row of canonical) {
      expect(rowOf(rows, row.vehicleId!)).toMatchObject({ totalLiters: Number(row.liters), totalFuelAmount: Number(row.amount) })
    }
  })

  it("no mezcla la serie facturada: la carga de fuel_loads no se suma", async () => {
    const rows = await getFleetOverview(session())

    // Con la carga facturada (999 L, 999.000) sumada serían 1.161 L y 1.160.200.
    expect(rowOf(rows, IDS.vA)).toMatchObject({ totalLiters: 162, totalFuelAmount: 161_200 })
  })

  it("una carga registrada en una faena fuera del alcance no cuenta: el vehículo queda en cero, no en nulo", async () => {
    const empty = await getFleetOverview(session({ worksiteIds: [IDS.wsC], isGlobal: false }))

    // C pertenece a la faena C, pero su única carga está registrada en la faena A.
    expect(rowOf(empty, IDS.vC)).toMatchObject({ totalLiters: 0, totalFuelAmount: 0, loadCount: 0 })
  })
})

describe("getFleetOverview · permisos y alcance", () => {
  it("sin combustibles:view_costs hay litros y cargas, pero ningún monto", async () => {
    const rows = await getFleetOverview(session({ permissions: ["flota:view", "combustibles:view"] }))

    expect(rowOf(rows, IDS.vA)).toMatchObject({ totalLiters: 162, loadCount: 3, totalFuelAmount: null })
  })

  it("con flota:view solamente no hay datos de combustible", async () => {
    const rows = await getFleetOverview(session({ permissions: ["flota:view"] }))

    expect(rowOf(rows, IDS.vA)).toMatchObject({ totalLiters: null, loadCount: null, totalFuelAmount: null })
  })

  it("la faena elegida en el tablero acota el combustible a esa faena", async () => {
    const rows = await getFleetOverview(session(), IDS.wsB)

    expect(rows.map((row) => row.id)).toEqual([IDS.vB])
    expect(rowOf(rows, IDS.vB).totalLiters).toBe(70)
  })

  it("aplica el alcance de faena del usuario a la faena de la transacción", async () => {
    const rows = await getFleetOverview(session({ isGlobal: false, worksiteIds: [IDS.wsA, IDS.wsC] }))

    // La carga de C se registró en la faena A (visible): cuenta. La de B no es visible.
    expect(rowOf(rows, IDS.vC)).toMatchObject({ totalLiters: 33, totalFuelAmount: 33_000, loadCount: 1 })
    expect(rows.map((row) => row.id)).not.toContain(IDS.vB)
  })
})

describe("getFleetOverviewPage · resumen de la lista", () => {
  const dates = { today: `${MONTH}-15`, warningWindowEnd: `${MONTH}-28` }

  it("el costo y los litros de 12 meses son la suma del libro del proveedor de los vehículos filtrados", async () => {
    const page = await getFleetOverviewPage(session(), {}, dates, { offset: 0, limit: 50 })

    // A (162 L, 161.200) + B (70 L, 80.000) + C (33 L, 33.000); la recepción TAE no es de ningún vehículo.
    expect(page.summary.totalLiters).toBe(265)
    expect(page.summary.totalFuelAmount).toBe(274_200)
  })

  it("sin combustibles:view_costs el resumen sólo trae litros", async () => {
    const page = await getFleetOverviewPage(session({ permissions: ["flota:view", "combustibles:view"] }), {}, dates, { offset: 0, limit: 50 })

    expect(page.summary).toMatchObject({ totalLiters: 265, totalFuelAmount: null })
  })
})
