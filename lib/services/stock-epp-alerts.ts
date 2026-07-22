/**
 * EPP Stock-alert service (F-5).
 *
 * Checks worksite stock against `minStock` thresholds specifically for EPP products (products.isEpp = true).
 */
import { db } from "@/db"
import { worksiteStock, worksites, products } from "@/db/schema"
import { and, eq, sql } from "drizzle-orm"
import { getStockAlerts, type StockAlert } from "./stock-alerts"

export async function getEppStockAlerts(): Promise<StockAlert[]> {
  const allAlerts = await getStockAlerts()
  const eppProductRows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.isEpp, true))

  const eppIds = new Set(eppProductRows.map((p) => p.id))
  return allAlerts.filter((alert) => eppIds.has(alert.productId))
}

export async function getCriticalEppStockAlertCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(worksiteStock)
    .innerJoin(products, eq(worksiteStock.productId, products.id))
    .where(
      and(
        eq(products.isEpp, true),
        sql`${worksiteStock.minStock} > 0 AND ${worksiteStock.quantity} < ${worksiteStock.minStock}`,
      ),
    )

  return row?.n ?? 0
}
