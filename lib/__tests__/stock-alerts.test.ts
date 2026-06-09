import { describe, it, expect, beforeAll } from "vitest"
import { db } from "@/db"
import { warehouses, products, warehouseStock, productCategories } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { getStockAlerts, getCriticalStockAlertCount } from "@/lib/services/stock-alerts"

/**
 * Stock-alerts unit tests.
 */

describe("stock alerts", () => {
  const warehouseId = nanoid()
  const categoryId  = nanoid()
  const safeProductId = nanoid()   // quantity=100, minStock=10 → no alert
  const alertProductId = nanoid()  // quantity=3,  minStock=10 → critical alert

  beforeAll(() => {
    db.insert(productCategories)
      .values({ id: categoryId, name: "Test Category", slug: `test-cat-${nanoid()}` })
      .run()
    db.insert(warehouses)
      .values({ id: warehouseId, name: "Test Bodega Alertas", code: `TEST-ALERT-${nanoid().slice(0, 8)}` })
      .run()
    db.insert(products)
      .values({ id: safeProductId, categoryId, name: "Safe Product", sku: `SAFE-${nanoid().slice(0, 8)}`, unitOfMeasure: "unidad" })
      .run()
    db.insert(products)
      .values({ id: alertProductId, categoryId, name: "Alert Product", sku: `ALERT-${nanoid().slice(0, 8)}`, unitOfMeasure: "unidad" })
      .run()
    db.insert(warehouseStock)
      .values({ id: nanoid(), warehouseId, productId: safeProductId, quantity: 100, minStock: 10 })
      .run()
    db.insert(warehouseStock)
      .values({ id: nanoid(), warehouseId, productId: alertProductId, quantity: 3, minStock: 10 })
      .run()
  })

  it("returns empty for products well above minStock", () => {
    const alerts = getStockAlerts()
    const safeAlerts = alerts.filter((a) => a.productId === safeProductId)
    expect(safeAlerts).toHaveLength(0)
  })

  it("returns critical alert when stock is below minStock", () => {
    const alerts = getStockAlerts()
    const criticalAlert = alerts.find((a) => a.productId === alertProductId)
    expect(criticalAlert).toBeDefined()
    expect(criticalAlert!.severity).toBe("critical")
    expect(criticalAlert!.deficit).toBe(7)
    expect(criticalAlert!.currentQty).toBe(3)
    expect(criticalAlert!.minStock).toBe(10)
  })

  it("getCriticalStockAlertCount returns correct count", () => {
    const count = getCriticalStockAlertCount()
    expect(typeof count).toBe("number")
    expect(count).toBeGreaterThanOrEqual(1)
  })
})
