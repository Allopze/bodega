import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
// `can()` real arrastra next-auth y next/headers; sólo se necesita el chequeo de permisos de la sesión.
vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission as never) ?? false,
}))

const { getFuelMonthlyTrend } = await import("@/lib/services/dashboard-fuel")
const { accountableProviderTransactionsWhere } = await import("@/lib/combustibles/load-status")

/**
 * C-9, segunda mitad: el tablero (vista «flota»: gráfico de consumo y litros de
 * 6 meses; vista «finanzas»: costo de combustible) leía `fuel_loads`, que en
 * producción tiene 0 filas. `getFuelMonthlyTrend` lee ahora el libro del proveedor
 * con la misma regla canónica que Analítica y la conciliación, y deja un hueco
 * (no un cero) donde el proveedor no tiene datos del mes (C-4).
 *
 * «Hoy» es el 2026-11-03: la ventana de 6 meses es junio–noviembre de 2026.
 */
const NOW = new Date("2026-11-03T15:00:00.000Z")
const FUEL_SUPPLIER = "fs-copec-dash"

function session(overrides: { worksiteIds?: string[]; isGlobal?: boolean; permissions?: string[] } = {}): Session {
  return {
    user: {
      id: IDS.user,
      isGlobal: overrides.isGlobal ?? true,
      roles: [],
      worksiteIds: overrides.worksiteIds ?? [],
      permissions: overrides.permissions ?? ["combustibles:view", "combustibles:view_costs"],
    },
    expires: "2099-01-01",
  } as unknown as Session
}

let counter = 0
function tx(overrides: Partial<typeof schema.fuelProviderTransactions.$inferInsert>): typeof schema.fuelProviderTransactions.$inferInsert {
  counter += 1
  return {
    id: `dft-${counter}`, syncRunId: IDS.run, provider: "copec", sourceAccount: "tct:diesel", identityKey: `dft-idk-${counter}`,
    fingerprint: `dft-fp-${counter}`, sourceRowKey: `dft-row-${counter}`, payloadHash: `dft-ph-${counter}`,
    supplierId: FUEL_SUPPLIER, worksiteId: IDS.wsA, vehicleId: IDS.vA, sourcePlate: "AA-0001",
    occurredAt: "2026-06-10T12:00:00.000Z", quantity: 100, amount: 100_000, status: "accepted", granularity: "transaction",
    ...overrides,
  }
}

function coverageRows(month: string, status: string, rowsAccepted: number): Array<typeof schema.fuelProviderPeriodCoverage.$inferInsert> {
  return ["tct:diesel", "tct:bluemax", "tae:diesel", "tae:bluemax"].map((account, index) => ({
    id: `dcov-${month}-${account}`, provider: "copec", sourceAccount: account, channel: account.slice(0, 3).toUpperCase(),
    product: account.slice(4), periodMonth: `${month}-01`, status, sourceAvailability: "available",
    rowsReceived: index === 0 ? rowsAccepted : 0, rowsAccepted: index === 0 ? rowsAccepted : 0,
  }))
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await pg.exec("SET TIME ZONE 'UTC'")
  await seedControlFixtures(db)
  await db.insert(schema.fuelSuppliers).values({ id: FUEL_SUPPLIER, name: "Copec de prueba" })
  await db.insert(schema.fuelProviderSyncRuns).values({ id: IDS.run, provider: "copec", requestedFrom: "2026-06-01", requestedTo: "2026-11-30", correlationId: "corr-dash-fuel" })
  await db.insert(schema.fuelProviderTransactions).values([
    // Junio, faena A: dos transacciones (60 + 40 L) y el agregado mensual TCT de la MISMA patente y cuenta,
    // que trae el mismo litro a otro nivel: sumarlo duplicaría el mes.
    tx({ id: "j-1", quantity: 60, amount: 60_000, occurredAt: "2026-06-10T12:00:00.000Z" }),
    tx({ id: "j-2", quantity: 40, amount: 40_000, occurredAt: "2026-06-20T12:00:00.000Z" }),
    tx({ id: "j-agg", granularity: "period_aggregate", quantity: 100, amount: 100_000, occurredAt: "2026-06-01" }),
    // Julio, faena B: una reemplazada (no cuenta) y su vigente; una pendiente, una excluida y una rechazada (no son consumo).
    tx({ id: "jl-old", worksiteId: IDS.wsB, vehicleId: IDS.vB, sourcePlate: "BB-0002", quantity: 7, amount: 7_000, occurredAt: "2026-07-05T12:00:00.000Z" }),
    tx({ id: "jl-new", worksiteId: IDS.wsB, vehicleId: IDS.vB, sourcePlate: "BB-0002", quantity: 50, amount: 50_000, occurredAt: "2026-07-05T12:00:00.000Z", supersedesId: "jl-old" }),
    tx({ id: "jl-pending", status: "pending", quantity: 999, amount: 999_000, occurredAt: "2026-07-06T12:00:00.000Z" }),
    tx({ id: "jl-excluded", status: "excluded", quantity: 888, amount: 888_000, occurredAt: "2026-07-06T12:00:00.000Z" }),
    tx({ id: "jl-rejected", status: "rejected", quantity: 777, amount: 777_000, occurredAt: "2026-07-06T12:00:00.000Z" }),
    // Octubre: agregado TCT SIN detalle de su mes. Cuenta, y representa las 4 cargas de su `detalle`.
    tx({
      id: "o-agg", granularity: "period_aggregate", quantity: 200, amount: 240_000, occurredAt: "2026-10-01",
      rawPayload: { detalle: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] },
    }),
  ])
  // Agosto: cerrado y vacío en la cobertura (un cero real). Septiembre y noviembre: sin fila alguna (hueco).
  await db.insert(schema.fuelProviderPeriodCoverage).values([
    ...coverageRows("2026-06", "complete", 3),
    ...coverageRows("2026-07", "complete", 1),
    ...coverageRows("2026-08", "complete", 0),
    ...coverageRows("2026-10", "incomplete", 1),
  ])
  // La serie facturada (`fuel_loads`) es OTRO concepto y no se mezcla: una carga facturada en septiembre
  // no debe llenar el hueco ni sumarse a ningún mes.
  await db.insert(schema.fuelLoads).values({
    id: "fl-sep", loadDate: "2026-09-10", month: "2026-09", serviceType: "TCT", vehicleId: IDS.vA, fuelSupplierId: FUEL_SUPPLIER,
    worksiteId: IDS.wsA, product: "PETROLEO DIESEL", productId: IDS.product, liters: 888, baseAmount: 888_000, totalAmount: 888_000,
    status: "registered", createdBy: IDS.user,
  })
}, 60_000)

afterAll(async () => { await pg.close() })

describe("getFuelMonthlyTrend · libro del proveedor con la regla canónica (C-9)", () => {
  it("devuelve los 6 meses que terminan en el actual, con su clave y su rótulo", async () => {
    const trend = await getFuelMonthlyTrend(session(), 6, undefined, NOW)

    expect(trend.map((point) => point.monthKey)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"])
    expect(trend.map((point) => point.month)).toEqual(["Jun", "Jul", "Ago", "Sep", "Oct", "Nov"])
  })

  it("marca como parcial sólo el mes en curso (3 de noviembre en Chile), también cuando el proveedor no tiene datos de él", async () => {
    const trend = await getFuelMonthlyTrend(session(), 6, undefined, NOW)

    expect(trend.filter((point) => point.partial).map((point) => point.monthKey)).toEqual(["2026-11"])
    // Noviembre es además un hueco del proveedor: son dos hechos distintos y ninguno oculta al otro.
    expect(trend.find((point) => point.monthKey === "2026-11")).toMatchObject({ providerGap: true, partial: true })
    expect(trend.find((point) => point.monthKey === "2026-10")).toMatchObject({ providerGap: false, partial: false })
  })

  it("suma litros, monto y cargas bajo la regla canónica: sin doble conteo del agregado TCT, reemplazadas ni no aceptadas", async () => {
    const trend = await getFuelMonthlyTrend(session(), 6, undefined, NOW)
    const byMonth = new Map(trend.map((point) => [point.monthKey, point]))

    expect(byMonth.get("2026-06")).toMatchObject({ liters: 100, amount: 100_000, loads: 2, providerGap: false })
    expect(byMonth.get("2026-07")).toMatchObject({ liters: 50, amount: 50_000, loads: 1, providerGap: false })
    // El agregado de octubre no tiene detalle: cuenta, y vale las 4 cargas de su `detalle`.
    expect(byMonth.get("2026-10")).toMatchObject({ liters: 200, amount: 240_000, loads: 4, providerGap: false })
  })

  it("cada mes cubierto es exactamente la suma de la regla compartida (accountableProviderTransactionsWhere)", async () => {
    const trend = await getFuelMonthlyTrend(session(), 6, undefined, NOW)
    const canonical = await db.select({
      month: sql<string>`left(${schema.fuelProviderTransactions.occurredAt}, 7)`,
      liters: sql<number>`coalesce(sum(${schema.fuelProviderTransactions.quantity}), 0)`,
      amount: sql<number>`coalesce(sum(${schema.fuelProviderTransactions.amount}), 0)`,
    }).from(schema.fuelProviderTransactions)
      .where(accountableProviderTransactionsWhere())
      .groupBy(sql`left(${schema.fuelProviderTransactions.occurredAt}, 7)`)

    expect(canonical.length).toBeGreaterThan(0)
    for (const row of canonical) {
      const point = trend.find((p) => p.monthKey === row.month)!
      expect({ month: row.month, liters: point.liters, amount: point.amount }).toEqual({ month: row.month, liters: Number(row.liters), amount: Number(row.amount) })
    }
    // Sin la regla, junio habría contado 200 L (el agregado duplica el mes) y julio habría sumado lo no aceptado.
    expect(trend.find((p) => p.monthKey === "2026-06")?.liters).not.toBe(200)
  })

  it("no mezcla la serie facturada: una carga de fuel_loads no llena el hueco de septiembre ni se suma", async () => {
    const trend = await getFuelMonthlyTrend(session(), 6, undefined, NOW)

    expect(trend.find((p) => p.monthKey === "2026-09")).toMatchObject({ liters: null, amount: null, loads: null, providerGap: true })
    expect(trend.reduce((sum, p) => sum + (p.liters ?? 0), 0)).toBe(350)
  })
})

describe("getFuelMonthlyTrend · meses sin datos del proveedor (C-4)", () => {
  it("un mes sin cobertura ni transacciones es un hueco: litros, monto y cargas en null", async () => {
    const trend = await getFuelMonthlyTrend(session(), 6, undefined, NOW)

    for (const key of ["2026-09", "2026-11"]) {
      expect(trend.find((p) => p.monthKey === key), key).toMatchObject({ liters: null, amount: null, loads: null, providerGap: true })
    }
  })

  it("un mes que la cobertura cierra vacío es un cero real, no un hueco", async () => {
    const trend = await getFuelMonthlyTrend(session(), 6, undefined, NOW)

    expect(trend.find((p) => p.monthKey === "2026-08")).toMatchObject({ liters: 0, amount: 0, loads: 0, providerGap: false })
  })

  it("con una faena filtrada, un mes con datos de otra faena es un cero, no un hueco", async () => {
    const trend = await getFuelMonthlyTrend(session(), 6, IDS.wsB, NOW)

    expect(trend.find((p) => p.monthKey === "2026-06")).toMatchObject({ liters: 0, providerGap: false })
    expect(trend.find((p) => p.monthKey === "2026-07")).toMatchObject({ liters: 50, providerGap: false })
    expect(trend.find((p) => p.monthKey === "2026-09")?.providerGap).toBe(true)
  })

  it("los huecos también salen sin combustibles:view_costs (los litros los necesitan igual)", async () => {
    const trend = await getFuelMonthlyTrend(session({ permissions: ["combustibles:view"] }), 6, undefined, NOW)

    expect(trend.find((p) => p.monthKey === "2026-09")).toMatchObject({ liters: null, providerGap: true })
  })
})

describe("getFuelMonthlyTrend · alcance y permisos", () => {
  it("sin combustibles:view_costs no hay montos, pero sí litros", async () => {
    const trend = await getFuelMonthlyTrend(session({ permissions: ["combustibles:view"] }), 6, undefined, NOW)

    expect(trend.every((point) => point.amount === null)).toBe(true)
    expect(trend.find((p) => p.monthKey === "2026-06")?.liters).toBe(100)
  })

  it("respeta el alcance de faena del usuario", async () => {
    const scoped = await getFuelMonthlyTrend(session({ isGlobal: false, worksiteIds: [IDS.wsB] }), 6, undefined, NOW)
    expect(scoped.find((p) => p.monthKey === "2026-06")?.liters).toBe(0)
    expect(scoped.find((p) => p.monthKey === "2026-07")).toMatchObject({ liters: 50, amount: 50_000 })

    const outside = await getFuelMonthlyTrend(session({ isGlobal: false, worksiteIds: [IDS.wsB] }), 6, IDS.wsA, NOW)
    expect(outside.find((p) => p.monthKey === "2026-06")?.liters).toBe(0)

    const none = await getFuelMonthlyTrend(session({ isGlobal: false, worksiteIds: [] }), 6, undefined, NOW)
    expect(none.every((p) => p.liters === 0 || p.liters === null)).toBe(true)
  })
})
