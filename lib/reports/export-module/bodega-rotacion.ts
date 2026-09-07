import { resolveProductSize } from "@/lib/products/product-size"
import { formatVariantProductName } from "@/lib/products/variant-grouping"
import type { Session } from "next-auth"
import { and, asc, eq, gte, sql } from "drizzle-orm"
import { db } from "@/db"
import { inventoryMovements, products, worksites, worksiteStock } from "@/db/schema"
import { buildWorksiteFilter } from "./utils"
import { formatDate } from "@/lib/utils"
import type { ReportData, ExportFilters } from "./types"
import { getProductAttributesByIds } from "@/lib/services/product-sizes"

const DEFAULT_WINDOW_DAYS = 90
const DEAD_STOCK_DAYS = 90

function windowStart(filters: ExportFilters): { from: string; days: number } {
  if (filters.fromDate) {
    const from = filters.fromDate.slice(0, 10)
    const days = Math.max(1, Math.round((Date.now() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000))
    return { from, days }
  }
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - DEFAULT_WINDOW_DAYS)
  return { from: date.toISOString().slice(0, 10), days: DEFAULT_WINDOW_DAYS }
}

/**
 * Rotación, cobertura y stock muerto.
 *
 * Consumo = suma de las salidas del período. Cobertura = existencias / consumo
 * diario. Sin consumo la cobertura no es infinita sino desconocida: va como
 * "—", nunca como un número que induzca a no reponer.
 */
export async function bodegaRotacion(
  session: Session | null,
  filters: ExportFilters,
  limit: number,
): Promise<ReportData> {
  const { from, days } = windowStart(filters)
  const stockScope = buildWorksiteFilter(session, worksiteStock.worksiteId)
  const movementScope = buildWorksiteFilter(session, inventoryMovements.worksiteId)
  const wsStockFilter = filters.worksiteId ? eq(worksiteStock.worksiteId, filters.worksiteId) : undefined
  const wsMovementFilter = filters.worksiteId ? eq(inventoryMovements.worksiteId, filters.worksiteId) : undefined

  const [stockRows, consumptionRows] = await Promise.all([
    db
      .select({
        worksiteId:    worksiteStock.worksiteId,
        worksiteName:  worksites.name,
        productId:     worksiteStock.productId,
        productName:   products.name,
        productSku:    products.sku,
        unitOfMeasure: products.unitOfMeasure,
        quantity:      worksiteStock.quantity,
        minStock:      worksiteStock.minStock,
        lastMovementAt: worksiteStock.lastMovementAt,
      })
      .from(worksiteStock)
      .innerJoin(products, eq(worksiteStock.productId, products.id))
      .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
      .where(and(eq(worksites.isActive, true), stockScope, wsStockFilter))
      .orderBy(asc(worksites.name), asc(products.name))
      .limit(limit + 1),
    db
      .select({
        worksiteId: inventoryMovements.worksiteId,
        productId:  inventoryMovements.productId,
        consumed:   sql<number>`sum(abs(${inventoryMovements.quantity}))`,
      })
      .from(inventoryMovements)
      .where(and(
        movementScope,
        wsMovementFilter,
        gte(inventoryMovements.performedAt, from),
        sql`${inventoryMovements.quantity} < 0`,
      ))
      .groupBy(inventoryMovements.worksiteId, inventoryMovements.productId),
  ])

  const rowLimitApplied = stockRows.length > limit
  const limited = rowLimitApplied ? stockRows.slice(0, limit) : stockRows

  const consumptionByKey = new Map(
    consumptionRows.map((row) => [`${row.worksiteId}:${row.productId}`, Number(row.consumed)]),
  )

  const deadCutoff = new Date()
  deadCutoff.setUTCDate(deadCutoff.getUTCDate() - DEAD_STOCK_DAYS)
  const deadCutoffIso = deadCutoff.toISOString().slice(0, 10)

  // La rotación se lee por variante: una talla puede ser stock muerto mientras
  // otra de la misma familia se agota. Sin la columna, las filas se confunden.
  const sizeById = await getProductAttributesByIds(limited.map((row) => row.productId))

  const rows = limited.map((row) => {
    const consumed = consumptionByKey.get(`${row.worksiteId}:${row.productId}`) ?? 0
    const dailyRate = consumed / days
    // Sin consumo la cobertura es desconocida, no infinita: un número aquí
    // se leería como "hay de sobra" y podría frenar una reposición necesaria.
    const coverage = dailyRate > 0 ? Math.round(row.quantity / dailyRate) : null
    const isDead = row.quantity > 0
      && (!row.lastMovementAt || row.lastMovementAt.slice(0, 10) < deadCutoffIso)

    return [
      row.worksiteName,
      formatVariantProductName(row.productName, sizeById.get(row.productId)),
      resolveProductSize(sizeById.get(row.productId) ?? [])?.label ?? "",
      row.productSku ?? "",
      row.unitOfMeasure,
      row.quantity,
      row.minStock > 0 ? row.minStock : "",
      consumed,
      Number(dailyRate.toFixed(2)),
      coverage === null ? "—" : coverage,
      row.lastMovementAt ? formatDate(row.lastMovementAt) : "",
      isDead ? "Sí" : "",
    ]
  })

  return {
    filenameBase: "bodega-rotacion",
    worksheetName: "Rotación",
    headers: [
      "Faena", "Producto", "Talla", "SKU", "U/M", "Stock actual", "Stock mínimo",
      `Consumo ${days} d`, "Consumo diario", "Cobertura (días)", "Último movimiento", "Stock muerto",
    ],
    rows,
    rowLimitApplied,
  }
}
