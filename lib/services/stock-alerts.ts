/**
 * Stock-alert service.
 *
 * Checks warehouse stock against `minStock` thresholds and returns
 * actionable alerts for products that are below or approaching their minimum.
 */
import { db } from "@/db"
import { warehouseStock, warehouses, products } from "@/db/schema"
import { eq, lt, gt, sql } from "drizzle-orm"

export interface StockAlert {
  warehouseId:    string
  warehouseName:  string
  productId:      string
  productName:    string
  productSku:     string | null
  currentQty:     number
  minStock:       number
  deficit:        number
  severity:       "critical" | "warning"
}

const WARNING_RATIO = 1.5 // 50% above minStock → warning

/**
 * Returns all stock alerts across all warehouses.
 * Only returns products where currentQty < minStock (critical) or
 * currentQty < minStock * WARNING_RATIO (warning).
 */
export function getStockAlerts(): StockAlert[] {
  const rows = db
    .select({
      warehouseId:   warehouseStock.warehouseId,
      warehouseName: warehouses.name,
      productId:     warehouseStock.productId,
      productName:   products.name,
      productSku:    products.sku,
      currentQty:    warehouseStock.quantity,
      minStock:      warehouseStock.minStock,
    })
    .from(warehouseStock)
    .innerJoin(warehouses, eq(warehouseStock.warehouseId, warehouses.id))
    .innerJoin(products, eq(warehouseStock.productId, products.id))
    .where(
      // Only rows with minStock > 0 AND currentQty < minStock * WARNING_RATIO
      sql`${warehouseStock.minStock} > 0
          AND ${warehouseStock.quantity} < ${warehouseStock.minStock} * ${WARNING_RATIO}`,
    )
    .all()

  return rows.map((row) => {
    const deficit = row.minStock - row.currentQty
    return {
      warehouseId:   row.warehouseId,
      warehouseName: row.warehouseName,
      productId:     row.productId,
      productName:   row.productName,
      productSku:    row.productSku,
      currentQty:    row.currentQty,
      minStock:      row.minStock,
      deficit:       Math.max(0, deficit),
      severity:      row.currentQty < row.minStock ? "critical" : "warning",
    } satisfies StockAlert
  })
}

/**
 * Returns the count of critical stock alerts.
 */
export function getCriticalStockAlertCount(): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(warehouseStock)
    .where(
      sql`${warehouseStock.minStock} > 0
          AND ${warehouseStock.quantity} < ${warehouseStock.minStock}`,
    )
    .get()

  return row?.n ?? 0
}
