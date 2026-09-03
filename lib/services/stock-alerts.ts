/**
 * Stock-alert service.
 *
 * Checks worksite stock against `minStock` thresholds and returns
 * actionable alerts for products that are below or approaching their minimum.
 */
import { db } from "@/db"
import { worksiteStock, worksites, products } from "@/db/schema"
import { and, eq, inArray, sql } from "drizzle-orm"
import { getProductSizesByIds } from "@/lib/services/product-sizes"
import { formatSizedProductName } from "@/lib/products/product-size"

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

/**
 * Una faena cerrada no admite movimientos de stock: su saldo no se puede
 * reponer ni consumir, así que una alerta sobre él no es accionable por nadie.
 */
const ACTIVE_WORKSITE = eq(worksites.isActive, true)

/**
 * Lista alertas sólo dentro del alcance ya resuelto por el caller. El stock es
 * un dato por faena: nunca se debe consultar globalmente para luego ocultar
 * filas en la UI de un usuario acotado.
 */
export async function getStockAlerts(worksiteIds: string[] | "all" = "all"): Promise<StockAlert[]> {
  const scopeFilter = worksiteIds === "all"
    ? undefined
    : worksiteIds.length > 0
      ? inArray(worksiteStock.worksiteId, worksiteIds)
      : sql`false`

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
    .where(and(
      scopeFilter,
      ACTIVE_WORKSITE,
      sql`${worksiteStock.minStock} > 0
          AND ${worksiteStock.quantity} <= ${worksiteStock.minStock} * 2.0`,
    ))

  const alerting = rows.filter((row) => row.currentQty < row.minStock * WARNING_RATIO)
  // Sin la talla, una familia bajo mínimo produce varias alertas con el mismo
  // texto y el bodeguero no sabe cuál talla reponer.
  const sizeById = await getProductSizesByIds(alerting.map((row) => row.productId))

  return alerting
    .map((row) => {
      const deficit = row.minStock - row.currentQty
      return {
        worksiteId:   row.worksiteId,
        worksiteName: row.worksiteName,
        productId:    row.productId,
        productName:  formatSizedProductName(row.productName, sizeById.get(row.productId)),
        productSku:   row.productSku,
        currentQty:   row.currentQty,
        minStock:     row.minStock,
        deficit,
        severity:     deficit > 0 ? "critical" : "warning",
      } satisfies StockAlert
    })
}

/**
 * Cuenta alertas críticas sólo dentro del alcance ya resuelto por el caller.
 * El default conserva el uso administrativo histórico; las vistas de usuario
 * deben entregar sus faenas autorizadas para no exponer un total global.
 */
export async function getCriticalStockAlertCount(worksiteIds: string[] | "all" = "all"): Promise<number> {
  const scopeFilter = worksiteIds === "all"
    ? undefined
    : worksiteIds.length > 0
      ? inArray(worksiteStock.worksiteId, worksiteIds)
      : sql`false`

  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(worksiteStock)
    .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
    .where(and(
      scopeFilter,
      ACTIVE_WORKSITE,
      sql`${worksiteStock.minStock} > 0
          AND ${worksiteStock.quantity} < ${worksiteStock.minStock}`,
    ))

  return row?.n ?? 0
}
