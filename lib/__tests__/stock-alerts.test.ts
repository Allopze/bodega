import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── In-memory PostgreSQL database & migrations ────────────────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js type differs only in result-type HKT
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { getStockAlerts, getCriticalStockAlertCount } from "@/lib/services/stock-alerts"

describe("stock alerts", () => {
  const worksiteId = nanoid()
  const categoryId  = nanoid()
  const safeProductId = nanoid()
  const alertProductId = nanoid()

  beforeAll(async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.productCategories)
      .values({ id: categoryId, name: "Test Category", slug: `test-cat-${nanoid()}` })
    await inMemoryDb.insert(schema.worksites)
      .values({ id: worksiteId, name: "Faena Test Alertas", code: `FA-${nanoid().slice(0, 8)}`, isActive: true, createdAt: now, updatedAt: now })
    await inMemoryDb.insert(schema.products)
      .values({ id: safeProductId, categoryId, name: "Safe Product", sku: `SAFE-${nanoid().slice(0, 8)}`, unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now })
    await inMemoryDb.insert(schema.products)
      .values({ id: alertProductId, categoryId, name: "Alert Product", sku: `ALERT-${nanoid().slice(0, 8)}`, unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now })
    await inMemoryDb.insert(schema.worksiteStock)
      .values({ id: nanoid(), worksiteId, productId: safeProductId, quantity: 100, minStock: 10, updatedAt: now })
    await inMemoryDb.insert(schema.worksiteStock)
      .values({ id: nanoid(), worksiteId, productId: alertProductId, quantity: 3, minStock: 10, updatedAt: now })
  })

  afterAll(async () => {
    await pg.close()
  })

  it("returns empty for products well above minStock", async () => {
    const alerts = await getStockAlerts()
    const safeAlerts = alerts.filter((a) => a.productId === safeProductId)
    expect(safeAlerts).toHaveLength(0)
  })

  it("returns critical alert when stock is below minStock", async () => {
    const alerts = await getStockAlerts()
    const criticalAlert = alerts.find((a) => a.productId === alertProductId)
    expect(criticalAlert).toBeDefined()
    expect(criticalAlert!.severity).toBe("critical")
    expect(criticalAlert!.deficit).toBe(7)
    expect(criticalAlert!.currentQty).toBe(3)
    expect(criticalAlert!.minStock).toBe(10)
  })

  it("getCriticalStockAlertCount returns correct count", async () => {
    const count = await getCriticalStockAlertCount()
    expect(typeof count).toBe("number")
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it("scopes critical counts to the supplied worksites", async () => {
    await expect(getCriticalStockAlertCount([worksiteId])).resolves.toBe(1)
    await expect(getCriticalStockAlertCount([])).resolves.toBe(0)
  })
})
