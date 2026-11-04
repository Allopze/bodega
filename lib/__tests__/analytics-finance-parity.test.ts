import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
// `can()` real arrastra next-auth y next/headers; sólo se necesita el chequeo de permisos de la sesión.
vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission as never) ?? false,
}))

const { getAnalyticsDashboard, getPurchasingFinancialSummary } = await import("@/lib/services/analytics-module/dashboard")
const { getOperationalPeriodMetrics } = await import("@/lib/services/operational-period-metrics")

/**
 * CHART-033 (AUDITORIA_VISUALIZACIONES_CHOME.md): /analitica y /dashboard?vista=finanzas daban
 * cifras distintas para el mismo período porque Analítica fechaba las OC por `createdAt` y
 * filtraba sólo por estado, mientras el tablero usa `issuedAt` + `issuedOrderPredicate`.
 *
 * Esta suite es la prueba de aceptación: las tres fuentes que alimentan lo que el usuario ve
 * —`getAnalyticsDashboard` (/analitica), `getPurchasingFinancialSummary` (rankings de Finanzas)
 * y `getOperationalPeriodMetrics` (los tiles de Finanzas)— dan la MISMA cifra de gasto en OC,
 * cuenta de OC, ranking de proveedores y reparto por tipo, en los tres períodos del tablero y
 * respetando la faena del usuario.
 *
 * El fixture está armado para que la base vieja (creación) y la nueva (emisión) discrepen:
 *  - A3 se creó en octubre pero se emitió el 30-sep: pertenece a septiembre;
 *  - A5 está eliminada y A6 no tiene fecha de emisión: la base vieja las contaba;
 *  - A7 está anulada y A4 es borrador: no son gasto.
 */

const WS_A = "ws-fp-a"
const WS_B = "ws-fp-b"
const USER = "u-fp"

type OrderSeed = {
  id: string; ws: string; supplier: string; status: string
  issuedAt: string | null; createdAt: string; net: number; deletedAt?: string
  item?: { id: string; requestItemId: string | null; status?: string }
}

/** total = neto × 1,19 (`computeOrderTotals`); el IVA se redondea como lo hace la plataforma. */
const totals = (net: number) => ({ netAmount: net, taxAmount: Math.round(net * 0.19), totalAmount: net + Math.round(net * 0.19) })

const ORDERS: OrderSeed[] = [
  { id: "oc-a1", ws: WS_A, supplier: "s-sur", status: "sent", issuedAt: "2026-10-05T14:00:00.000Z", createdAt: "2026-09-20T12:00:00.000Z", net: 100_000, item: { id: "poi-a1", requestItemId: "ri-epp" } },
  { id: "oc-a2", ws: WS_A, supplier: "s-norte", status: "received", issuedAt: "2026-10-20T10:00:00.000Z", createdAt: "2026-10-18T12:00:00.000Z", net: 50_000, item: { id: "poi-a2", requestItemId: "ri-rep" } },
  // Creada en octubre, emitida el 30-sep: septiembre en la base nueva.
  { id: "oc-a3", ws: WS_A, supplier: "s-sur", status: "sent", issuedAt: "2026-09-30T20:00:00.000Z", createdAt: "2026-10-02T12:00:00.000Z", net: 20_000 },
  { id: "oc-a4", ws: WS_A, supplier: "s-sur", status: "draft", issuedAt: null, createdAt: "2026-10-03T12:00:00.000Z", net: 10_000 },
  // Eliminada (soft-delete): la base vieja la sumaba.
  { id: "oc-a5", ws: WS_A, supplier: "s-sur", status: "sent", issuedAt: "2026-10-12T10:00:00.000Z", createdAt: "2026-10-12T09:00:00.000Z", net: 30_000, deletedAt: "2026-10-13T10:00:00.000Z" },
  // Estado activo pero sin fecha de emisión: no es una OC emitida.
  { id: "oc-a6", ws: WS_A, supplier: "s-sur", status: "sent", issuedAt: null, createdAt: "2026-10-07T12:00:00.000Z", net: 40_000 },
  { id: "oc-a7", ws: WS_A, supplier: "s-sur", status: "cancelled", issuedAt: "2026-10-09T10:00:00.000Z", createdAt: "2026-10-09T09:00:00.000Z", net: 15_000 },
  // Otra faena, línea sin solicitud de origen (cae en «Otros»).
  { id: "oc-b1", ws: WS_B, supplier: "s-sur", status: "sent", issuedAt: "2026-10-15T10:00:00.000Z", createdAt: "2026-10-15T09:00:00.000Z", net: 200_000, item: { id: "poi-b1", requestItemId: null } },
]

function session(overrides: { worksiteIds?: string[]; isGlobal?: boolean; permissions?: string[] } = {}): Session {
  return {
    user: {
      id: USER, isActive: true, roles: [],
      isGlobal: overrides.isGlobal ?? true,
      worksiteIds: overrides.worksiteIds ?? [],
      permissions: overrides.permissions ?? ["analytics:view", "purchasing:view"],
    },
    expires: "2099-01-01",
  } as unknown as Session
}

const OCTOBER = { fromDate: "2026-10-01", toDate: "2026-10-31" }
const OCTOBER_NOW = new Date("2026-10-15T15:00:00Z")

/** Las tres fuentes que ve el usuario, para un mismo período y sesión. */
async function figures(s: Session, window: { fromDate: string; toDate: string }, period: "mes" | "trimestre" | "anio", now: Date) {
  const [analytics, summary, metrics] = await Promise.all([
    getAnalyticsDashboard(s, window),
    getPurchasingFinancialSummary(s, window),
    getOperationalPeriodMetrics(s, { period, now }),
  ])
  return { analytics, summary, metrics }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  // La sesión corre en UTC, como el despliegue.
  await pg.exec("SET TIME ZONE 'UTC'")
  await db.insert(schema.worksites).values([
    { id: WS_A, code: "FP-A", name: "Faena A" },
    { id: WS_B, code: "FP-B", name: "Faena B" },
  ])
  await db.insert(schema.users).values({ id: USER, name: "QA", email: "fp@test.local", hashedPassword: "hash" })
  await db.insert(schema.suppliers).values([{ id: "s-sur", name: "Ferretería Sur" }, { id: "s-norte", name: "EPP Norte" }])
  await db.insert(schema.purchaseRequests).values([
    { id: "r-epp", code: "SOL-FP-1", worksiteId: WS_A, requesterId: USER, requestType: "epp", status: "closed" },
    { id: "r-rep", code: "SOL-FP-2", worksiteId: WS_A, requesterId: USER, requestType: "repuestos", status: "closed" },
  ])
  await db.insert(schema.purchaseRequestItems).values([
    { id: "ri-epp", requestId: "r-epp", quantity: 1, status: "received" },
    { id: "ri-rep", requestId: "r-rep", quantity: 1, status: "received" },
  ])
  await db.insert(schema.purchaseOrders).values(ORDERS.map((o) => ({
    id: o.id, code: o.id.toUpperCase(), worksiteId: o.ws, supplierId: o.supplier, createdBy: USER, status: o.status,
    issuedAt: o.issuedAt, createdAt: o.createdAt, deletedAt: o.deletedAt ?? null, ...totals(o.net),
  })))
  await db.insert(schema.purchaseOrderItems).values(ORDERS.flatMap((o) => o.item
    ? [{ id: o.item.id, purchaseOrderId: o.id, requestItemId: o.item.requestItemId, quantity: 1, unitPrice: o.net, subtotal: o.net, status: o.item.status ?? "issued" }]
    : []))
}, 60_000)

afterAll(async () => { await pg.close() })

describe("CHART-033 · /analitica y Finanzas del tablero dan la misma cifra", () => {
  it("el gasto en OC de octubre es el mismo en los tres lugares: sólo cuentan las emitidas, por su fecha de emisión", async () => {
    const { analytics, summary, metrics } = await figures(session(), OCTOBER, "mes", OCTOBER_NOW)

    // A1 119.000 + A2 59.500 + B1 238.000. A3 es de septiembre; A4, A5, A6 y A7 no son OC emitidas.
    expect(analytics.kpis.totalSpend).toBe(416_500)
    expect(summary.kpis.totalSpend).toBe(416_500)
    expect(metrics.spend.current).toBe(416_500)

    expect(analytics.kpis.purchaseOrderCount).toBe(3)
    expect(summary.kpis.purchaseOrderCount).toBe(3)
    expect(metrics.ordersIssued.current).toBe(3)

    expect(analytics.kpis.averageOrderAmount).toBeCloseTo(416_500 / 3, 6)
    expect(analytics.kpis.averageOrderAmount).toBeCloseTo(summary.kpis.averageOrderAmount, 6)
  })

  it.each([
    ["mes", { fromDate: "2026-10-01", toDate: "2026-10-31" }, new Date("2026-10-15T15:00:00Z"), 416_500],
    ["trimestre", { fromDate: "2026-10-01", toDate: "2026-12-31" }, new Date("2026-11-20T15:00:00Z"), 416_500],
    // Con el año entra A3 (emitida el 30-sep): 416.500 + 23.800.
    ["anio", { fromDate: "2026-01-01", toDate: "2026-12-31" }, new Date("2026-11-20T15:00:00Z"), 440_300],
  ] as const)("período %s: Analítica coincide con el tablero", async (period, window, now, expected) => {
    const { analytics, summary, metrics } = await figures(session(), window, period, now)

    expect([analytics.kpis.totalSpend, summary.kpis.totalSpend, metrics.spend.current]).toEqual([expected, expected, expected])
    expect(analytics.kpis.purchaseOrderCount).toBe(metrics.ordersIssued.current)
  })

  it("el ranking de proveedores y el reparto por tipo son los mismos que muestra Finanzas, y el reparto suma el total (con IVA)", async () => {
    const { analytics, summary } = await figures(session(), OCTOBER, "mes", OCTOBER_NOW)

    expect(analytics.topSuppliers).toEqual(summary.topSuppliers)
    expect(analytics.topSuppliers.map((s) => [s.name, s.totalAmount, s.count])).toEqual([
      ["Ferretería Sur", 357_000, 2], // A1 119.000 + B1 238.000
      ["EPP Norte", 59_500, 1],
    ])
    expect(analytics.spendByModule).toEqual(summary.spendByModule)
    // Neto 100.000 → 119.000 con IVA: el desglose ya no queda 19 % por debajo del KPI.
    expect(analytics.spendByModule).toEqual([
      { module: "Otros", totalAmount: 238_000 },
      { module: "EPP", totalAmount: 119_000 },
      { module: "Repuestos", totalAmount: 59_500 },
    ])
    expect(analytics.spendByModule.reduce((sum, row) => sum + row.totalAmount, 0)).toBe(analytics.kpis.totalSpend)
  })

  it("la tendencia mensual usa el mes de emisión: A3 es de septiembre aunque se creó en octubre", async () => {
    const { analytics } = await figures(session(), OCTOBER, "mes", OCTOBER_NOW)

    const byMonth = Object.fromEntries(analytics.spendByMonth.map((row) => [row.month, row.purchasingAmount]))
    expect(byMonth["2026-09"]).toBe(23_800)
    expect(byMonth["2026-10"]).toBe(416_500)
    // El mes del KPI y el de la serie son la misma cifra.
    expect(byMonth["2026-10"]).toBe(analytics.kpis.totalSpend)
  })

  it("«Órdenes recientes» lista las emitidas, por fecha de emisión", async () => {
    const { analytics } = await figures(session(), OCTOBER, "mes", OCTOBER_NOW)

    expect(analytics.recentOrders.map((o) => o.code)).toEqual(["OC-A2", "OC-B1", "OC-A1"])
    expect(analytics.recentOrders[0]?.issuedAt).toBe("2026-10-20T10:00:00.000Z")
  })

  it("el período de comparación de Analítica usa la misma base: A3 es el gasto previo de septiembre", async () => {
    const { analytics } = await figures(session(), OCTOBER, "mes", OCTOBER_NOW)

    expect(analytics.kpis.previousTotalSpend).toBe(23_800)
  })

  it("expone el umbral de concentración con el que se evalúa la alerta", async () => {
    const { analytics } = await figures(session(), OCTOBER, "mes", OCTOBER_NOW)

    expect(analytics.supplierConcentrationPct).toBe(60)
  })
})

describe("CHART-033 · el alcance de faenas se mantiene (una faena no ve a la otra)", () => {
  it("un usuario de la faena A ve sólo el gasto de A, igual en las tres fuentes", async () => {
    const { analytics, summary, metrics } = await figures(session({ isGlobal: false, worksiteIds: [WS_A] }), OCTOBER, "mes", OCTOBER_NOW)

    // A1 119.000 + A2 59.500: nada de B1 (238.000).
    expect([analytics.kpis.totalSpend, summary.kpis.totalSpend, metrics.spend.current]).toEqual([178_500, 178_500, 178_500])
    expect(analytics.topSuppliers.map((s) => s.name)).toEqual(["Ferretería Sur", "EPP Norte"])
    expect(analytics.recentOrders.map((o) => o.code)).not.toContain("OC-B1")
    expect(analytics.spendByModule.map((m) => m.module)).not.toContain("Otros")
  })

  it("un usuario de la faena B ve sólo B", async () => {
    const { analytics, summary, metrics } = await figures(session({ isGlobal: false, worksiteIds: [WS_B] }), OCTOBER, "mes", OCTOBER_NOW)

    expect([analytics.kpis.totalSpend, summary.kpis.totalSpend, metrics.spend.current]).toEqual([238_000, 238_000, 238_000])
    expect(analytics.recentOrders.map((o) => o.code)).toEqual(["OC-B1"])
  })

  it("sin faenas asignadas no ve nada (una lista vacía no es «sin filtro»)", async () => {
    const { analytics, summary, metrics } = await figures(session({ isGlobal: false, worksiteIds: [] }), OCTOBER, "mes", OCTOBER_NOW)

    expect([analytics.kpis.totalSpend, summary.kpis.totalSpend, metrics.spend.current]).toEqual([0, 0, 0])
    expect(analytics.topSuppliers).toEqual([])
  })

  it("elegir una faena ajena no amplía el alcance: la intersección es vacía", async () => {
    const analytics = await getAnalyticsDashboard(session({ isGlobal: false, worksiteIds: [WS_A] }), { ...OCTOBER, worksiteId: WS_B })

    expect(analytics.kpis.totalSpend).toBe(0)
  })
})
