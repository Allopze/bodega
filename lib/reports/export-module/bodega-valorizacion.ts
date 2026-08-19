import type { Session } from "next-auth"
import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { productCategories, products, worksites, worksiteStock } from "@/db/schema"
import { buildWorksiteFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"

/**
 * Valorización del inventario: existencias × precio de referencia.
 *
 * `products.referencePrice` es nullable y ningún reporte lo usaba. Los
 * productos sin precio **no** se cuentan como cero: un valorizado que suma
 * silenciosamente cero es peor que no tenerlo. Van en su propia hoja para que
 * se vea exactamente qué quedó fuera del total.
 */
export async function bodegaValorizacion(
  session: Session | null,
  filters: ExportFilters,
  limit: number,
): Promise<ReportData> {
  const scopeFilter = buildWorksiteFilter(session, worksiteStock.worksiteId)
  const wsFilter = filters.worksiteId ? eq(worksiteStock.worksiteId, filters.worksiteId) : undefined

  const rows = await db
    .select({
      worksiteName:  worksites.name,
      productName:   products.name,
      productSku:    products.sku,
      categoryName:  productCategories.name,
      unitOfMeasure: products.unitOfMeasure,
      quantity:      worksiteStock.quantity,
      referencePrice: products.referencePrice,
    })
    .from(worksiteStock)
    .innerJoin(products, eq(worksiteStock.productId, products.id))
    .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(eq(worksites.isActive, true), sql`${worksiteStock.quantity} > 0`, scopeFilter, wsFilter))
    .orderBy(asc(worksites.name), asc(products.name))
    .limit(limit + 1)

  const rowLimitApplied = rows.length > limit
  const limited = rowLimitApplied ? rows.slice(0, limit) : rows

  const priced = limited.filter((row) => row.referencePrice !== null && row.referencePrice !== undefined)
  const unpriced = limited.filter((row) => row.referencePrice === null || row.referencePrice === undefined)

  const totalValue = priced.reduce((sum, row) => sum + row.quantity * Number(row.referencePrice), 0)

  return {
    filenameBase: "bodega-valorizacion",
    worksheetName: "Valorización",
    headers: ["Faena", "Producto", "SKU", "Categoría", "U/M", "Cantidad", "Precio referencia", "Valor"],
    rows: [
      ...priced.map((row) => [
        row.worksiteName,
        row.productName,
        row.productSku ?? "",
        row.categoryName ?? "",
        row.unitOfMeasure,
        row.quantity,
        Number(row.referencePrice),
        row.quantity * Number(row.referencePrice),
      ]),
      ["", "", "", "", "", "", "TOTAL VALORIZADO", totalValue],
    ],
    sheets: [
      {
        worksheetName: "Sin precio",
        headers: ["Faena", "Producto", "SKU", "U/M", "Cantidad"],
        rows: unpriced.length === 0
          ? [["", "Todos los productos con stock tienen precio de referencia", "", "", ""]]
          : unpriced.map((row) => [
              row.worksiteName,
              row.productName,
              row.productSku ?? "",
              row.unitOfMeasure,
              row.quantity,
            ]),
      },
    ],
    rowLimitApplied,
  }
}
