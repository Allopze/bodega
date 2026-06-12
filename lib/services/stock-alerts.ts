/**
 * Stock-alert service.
 *
 * Checks worksite stock against `minStock` thresholds and returns
 * actionable alerts for products that are below or approaching their minimum.
 */
import { db } from "@/db"
import { worksiteStock, worksites, products } from "@/db/schema"
import { eq, sql } from "drizzle-orm"

export interface StockAlert {
  worksiteId:    string
  worksiteName:  string
  productId:     string
  productName:   string
  productSku:    string | null
  currentQty:    number
  minStock:      number
  deficit:       number
  severity:      "critical" | "warning"
}

const WARNING_RATIO = 1.5

export async function getStockAlerts(): Promise<StockAlert[]> {
  const rows = await db
    .select({
      worksiteId:   worksiteStock.worksiteId,
      worksiteName: worksites.name,
      productId:    worksiteStock.productId,
      productName:  products.name,
      productSku:   products.sku,
      currentQty:   worksiteStock.quantity,
      minStock:     worksiteStock.minStock,
    })
    .from(worksiteStock)
    .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
    .innerJoin(products, eq(worksiteStock.productId, products.id))
    .where(
      sql`${worksiteStock.minStock} > 0
          AND ${worksiteStock.quantity} < ${worksiteStock.minStock} * ${WARNING_RATIO}`,
    )

  return rows.map((row) => {
    const deficit = row.minStock - row.currentQty
    return {
      worksiteId:   row.worksiteId,
      worksiteName: row.worksiteName,
      productId:    row.productId,
      productName:  row.productName,
      productSku:   row.productSku,
      currentQty:   row.currentQty,
      minStock:     row.minStock,
      deficit:      Math.max(0, deficit),
      severity:     row.currentQty < row.minStock ? "critical" : "warning",
    } satisfies StockAlert
  })
}

export async function getCriticalStockAlertCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(worksiteStock)
    .where(
      sql`${worksiteStock.minStock} > 0
          AND ${worksiteStock.quantity} < ${worksiteStock.minStock}`,
    )

  return row?.n ?? 0
}
