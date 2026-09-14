import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, count, eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { dateFilter, chileMonthExpr } = await import("@/lib/services/analytics-module/helpers")

/**
 * ANA-001 (auditoría 2026-09-14): los cortes de período de Analítica comparaban
 * instantes UTC (`>= fromDate` y `<= toDate + 'T23:59:59'`) contra columnas
 * `timestamptz`. En el despliegue la sesión de base de datos corre en UTC, así
 * que el "día" analítico iba de las 21:00 del día anterior a las 20:59 del día
 * chileno: una OC emitida a las 22:00 del último día del mes contaba en el mes
 * siguiente y una de la víspera se colaba al inicio del rango.
 *
 * Las tres OC de este fixture son exactamente ese borde. Enero en Chile es
 * UTC-3, de modo que la hora chilena y el instante UTC caen en días distintos.
 */
const ORDERS = [
  // 2025-12-31 23:30 en Chile → 2026-01-01 02:30 UTC. Es de diciembre: NO entra
  // en enero. El filtro UTC anterior la contaba (la víspera colada).
  { id: "ana-vispera", code: "ANA-VISPERA", createdAt: "2026-01-01T02:30:00.000Z", month: "2025-12" },
  // 2026-01-15 12:00 en Chile: dentro del rango con cualquier criterio.
  { id: "ana-medio", code: "ANA-MEDIO", createdAt: "2026-01-15T15:00:00.000Z", month: "2026-01" },
  // 2026-01-31 23:30 en Chile → 2026-02-01 02:30 UTC. Es del último día de
  // enero: SÍ entra. El filtro UTC anterior la dejaba fuera (la nocturna).
  { id: "ana-nocturna", code: "ANA-NOCTURNA", createdAt: "2026-02-01T02:30:00.000Z", month: "2026-01" },
]

describe("cortes de período de Analítica en día civil chileno (ANA-001)", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    // La sesión corre en UTC, como el despliegue: si el corte dependiera de la
    // zona de la sesión, aquí es donde se notaría.
    await pg.exec("SET TIME ZONE 'UTC'")
    await db.insert(schema.worksites).values({ id: "ana-ws", code: "ANA-WS", name: "QA analítica" })
    await db.insert(schema.users).values({ id: "ana-user", name: "QA", email: "ana@test.local", hashedPassword: "hash" })
    await db.insert(schema.suppliers).values({ id: "ana-supplier", name: "QA proveedor" })
    await db.insert(schema.purchaseOrders).values(ORDERS.map((order) => ({
      id: order.id, code: order.code, worksiteId: "ana-ws", supplierId: "ana-supplier",
      createdBy: "ana-user", status: "sent", totalAmount: 1000, createdAt: order.createdAt,
    })))
  })
  afterAll(async () => { await pg.close() })

  it("cuenta la OC de las 23:30 del último día chileno y excluye la de la víspera", async () => {
    const rows = await db.select({ id: schema.purchaseOrders.id })
      .from(schema.purchaseOrders)
      .where(and(
        eq(schema.purchaseOrders.worksiteId, "ana-ws"),
        dateFilter({ fromDate: "2026-01-01", toDate: "2026-01-31" }, schema.purchaseOrders.createdAt),
      ))
      .orderBy(asc(schema.purchaseOrders.id))

    expect(rows.map((row) => row.id)).toEqual(["ana-medio", "ana-nocturna"])
  })

  it("el período de comparación (diciembre) se lleva la OC nocturna de la víspera", async () => {
    const [row] = await db.select({ total: count() })
      .from(schema.purchaseOrders)
      .where(dateFilter({ fromDate: "2025-12-01", toDate: "2025-12-31" }, schema.purchaseOrders.createdAt))

    expect(row?.total).toBe(1)
  })

  it("la serie mensual agrupa por mes civil chileno, no por mes UTC", async () => {
    const rows = await db.select({ month: chileMonthExpr(schema.purchaseOrders.createdAt), total: count() })
      .from(schema.purchaseOrders)
      .groupBy(chileMonthExpr(schema.purchaseOrders.createdAt))
      .orderBy(sql`1`)

    expect(rows).toEqual([{ month: "2025-12", total: 1 }, { month: "2026-01", total: 2 }])
  })
})
