import { resolveProductSize } from "@/lib/products/product-size"
import { formatVariantProductName } from "@/lib/products/variant-grouping"
/**
 * Stock and kardex Excel export functions.
 */

import { eq, and, sql, inArray } from "drizzle-orm"
import { db } from "@/db"
import { worksites, worksiteStock, inventoryMovements, mantRecords, mantWorkOrders, products, users } from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { buildXlsxBuffer, type ReportData } from "@/lib/reports/export"
import { periodSql } from "@/lib/adquisiciones/list-query"
import { kardexTypeLabel } from "@/lib/bodega/kardex-labels"
import type { Session } from "next-auth"
import { todayInChile } from "@/lib/utils"
import { getProductAttributesByIds } from "@/lib/services/product-sizes"
import { getIncomingWithoutStock, getStockAvailability } from "@/lib/services/stock-availability"
import { loadSpareStockLevels, stockLevelKey } from "@/lib/services/bodega-spare-stock"
import { mantRecordOfMovement } from "@/lib/services/stock-mant-reference"

export interface StockExportFilters {
  worksiteId?: string
}

/**
 * Build an Excel buffer with the current stock for the given session's scope.
 * Respects RBAC worksite visibility.
 */
export async function getStockExport(
  session: Session | null,
  filters: StockExportFilters = {},
  maxRows = 10_000,
): Promise<{ buffer: ArrayBuffer; filename: string; truncated: boolean }> {
  const wsScope = isGlobalRole(session)
    ? undefined
    : (() => {
        const ids = visibleWorksiteIds(session)
        return ids.length > 0 ? inArray(worksiteStock.worksiteId, ids) : sql<boolean>`false`
      })()

  const wsFilter = filters.worksiteId
    ? eq(worksiteStock.worksiteId, filters.worksiteId)
    : undefined

  const rows = await db
    .select({
      id:             worksiteStock.id,
      worksiteId:     worksiteStock.worksiteId,
      worksiteName:   worksites.name,
      productId:      worksiteStock.productId,
      productName:    products.name,
      productSku:     products.sku,
      unitOfMeasure:  products.unitOfMeasure,
      isSparePart:    products.isSparePart,
      quantity:       worksiteStock.quantity,
      lastMovementAt: worksiteStock.lastMovementAt,
    })
    .from(worksiteStock)
    .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
    .innerJoin(products, eq(worksiteStock.productId, products.id))
    // Es la foto de las existencias de hoy y debe cuadrar con lo que muestra
    // Bodega, que sólo lista faenas activas. El kardex de más abajo sí conserva
    // las faenas cerradas: un movimiento pasado es información válida.
    .where(and(wsScope, wsFilter, eq(worksites.isActive, true)))
    .orderBy(worksites.name, products.name)
    .limit(maxRows + 1)

  const truncated = rows.length > maxRows
  const limited = truncated ? rows.slice(0, maxRows) : rows
  // Los repuestos también entran: tienen stock por faena (ADR mantención 0001).
  const availabilityRows = await getStockAvailability(session, { worksiteId: filters.worksiteId })
  // Lo pedido para una faena que nunca tuvo el producto: la pantalla lo
  // muestra en 0, y la planilla tiene que decir lo mismo.
  const incomingOnly = await getIncomingWithoutStock(availabilityRows)
  // La talla va en columna propia y no pegada al nombre: así la planilla se
  // puede filtrar y dinamizar por talla, que es para lo que se exporta. Sin
  // ella todas las variantes de una familia salían con el mismo texto.
  const [sizeById, incomingWorksites] = await Promise.all([
    getProductAttributesByIds([...limited, ...incomingOnly].map((r) => r.productId)),
    incomingOnly.length > 0
      ? db
          .select({ id: worksites.id, name: worksites.name })
          .from(worksites)
          .where(inArray(worksites.id, [...new Set(incomingOnly.map((r) => r.worksiteId))]))
      : Promise.resolve([]),
  ])
  const availabilityByKey = new Map(
    availabilityRows.map((row) => [`${row.worksiteId}\u0000${row.productId}`, row]),
  )
  const worksiteNameById = new Map(incomingWorksites.map((w) => [w.id, w.name]))
  const exportRows = [
    ...limited,
    ...incomingOnly.map((r) => ({
      worksiteId: r.worksiteId,
      worksiteName: worksiteNameById.get(r.worksiteId) ?? "",
      productId: r.productId,
      productName: r.productName,
      productSku: r.productSku,
      unitOfMeasure: r.unitOfMeasure,
      isSparePart: r.isSparePart,
      quantity: 0,
      lastMovementAt: null,
    })),
  ].sort((a, b) => a.worksiteName.localeCompare(b.worksiteName, "es")
    || a.productName.localeCompare(b.productName, "es"))

  // «Reservado OT» y «Libre» sólo para los repuestos: el resto de las filas va con las celdas vacías.
  const spareLevels = await loadSpareStockLevels(exportRows)

  const report: ReportData = {
    filenameBase: "stock-por-faena",
    worksheetName: "Stock",
    headers: [
      "Faena",
      "Producto",
      "Talla",
      "SKU",
      "U/M",
      "En bodega",
      "Por recibir",
      "Último movimiento",
      // Al final para no mover las columnas que ya conocen quienes usan la planilla.
      "Reservado OT",
      "Libre",
    ],
    rows: exportRows.map((r) => {
      const availability = availabilityByKey.get(`${r.worksiteId}\u0000${r.productId}`)
      const spare = spareLevels.get(stockLevelKey(r.worksiteId, r.productId))
      return [
        r.worksiteName,
        formatVariantProductName(r.productName, sizeById.get(r.productId)),
        resolveProductSize(sizeById.get(r.productId) ?? [])?.label ?? "",
        r.productSku ?? "",
        r.unitOfMeasure,
        r.quantity,
        availability?.incoming ?? 0,
        r.lastMovementAt ?? "",
        spare?.reserved ?? "",
        spare?.free ?? "",
      ]
    }),
    rowLimitApplied: truncated,
  }

  const buffer = await buildXlsxBuffer(report)
  const now = todayInChile()
  const filename = `${report.filenameBase}-${now}.xlsx`

  return { buffer, filename, truncated }
}

export interface KardexExportFilters {
  worksiteId?: string
  productId?:  string
  /** `YYYY-MM-DD`, ambos inclusive. Ver `periodSql`: el límite superior se
   *  traduce a `< hasta + 1 día` para que el día `hasta` entre completo. */
  from?:       string
  to?:         string
}

/**
 * Build an Excel buffer with the inventory movement history (kardex)
 * for the given session's scope. Respects RBAC worksite visibility.
 */
export async function getKardexExport(
  session: Session | null,
  filters: KardexExportFilters = {},
  maxRows = 10_000,
): Promise<{ buffer: ArrayBuffer; filename: string; truncated: boolean }> {
  const wsScope = isGlobalRole(session)
    ? undefined
    : (() => {
        const ids = visibleWorksiteIds(session)
        return ids.length > 0 ? inArray(inventoryMovements.worksiteId, ids) : sql<boolean>`false`
      })()

  const wsFilter = filters.worksiteId
    ? eq(inventoryMovements.worksiteId, filters.worksiteId)
    : undefined

  const prodFilter = filters.productId
    ? eq(inventoryMovements.productId, filters.productId)
    : undefined

  const periodFilter = periodSql(
    inventoryMovements.performedAt,
    filters.from ?? "",
    filters.to ?? "",
  )

  const rows = await db
    .select({
      id:              inventoryMovements.id,
      worksiteId:      inventoryMovements.worksiteId,
      worksiteName:    worksites.name,
      productId:       inventoryMovements.productId,
      productName:     products.name,
      productSku:      products.sku,
      type:            inventoryMovements.type,
      referenceType:   inventoryMovements.referenceType,
      quantity:        inventoryMovements.quantity,
      stockBefore:     inventoryMovements.stockBefore,
      stockAfter:      inventoryMovements.stockAfter,
      performedAt:     inventoryMovements.performedAt,
      performedByName: users.name,
      reason:          inventoryMovements.reason,
      notes:           inventoryMovements.notes,
      // Uso de un repuesto (o su reverso): el registro de mantención y la OT de ese registro.
      recordFolio:     mantRecords.folio,
      workOrderFolio:  mantWorkOrders.folio,
    })
    .from(inventoryMovements)
    .innerJoin(worksites, eq(inventoryMovements.worksiteId, worksites.id))
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .innerJoin(users, eq(inventoryMovements.performedBy, users.id))
    .leftJoin(mantRecords, mantRecordOfMovement)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantRecords.workOrderId))
    .where(and(wsScope, wsFilter, prodFilter, periodFilter))
    .orderBy(sql`${inventoryMovements.performedAt} DESC`)
    .limit(maxRows + 1)

  const truncated = rows.length > maxRows
  const limited = truncated ? rows.slice(0, maxRows) : rows
  const sizeById = await getProductAttributesByIds(limited.map((r) => r.productId))

  const report: ReportData = {
    filenameBase: "kardex-movimientos",
    worksheetName: "Kardex",
    headers: [
      "Fecha",
      "Faena",
      "Producto",
      "Talla",
      "SKU",
      "Tipo de movimiento",
      "Cantidad",
      "Stock anterior",
      "Stock posterior",
      "Responsable",
      "Motivo",
      "Observaciones",
      // Al final para no mover las columnas que ya conocen quienes usan la planilla.
      "OT",
      "Registro de mantención",
    ],
    rows: limited.map((r) => [
      r.performedAt ?? "",
      r.worksiteName,
      formatVariantProductName(r.productName, sizeById.get(r.productId)),
      resolveProductSize(sizeById.get(r.productId) ?? [])?.label ?? "",
      r.productSku ?? "",
      kardexTypeLabel(r.type, r.referenceType),
      r.quantity,
      r.stockBefore,
      r.stockAfter,
      r.performedByName,
      r.reason ?? "",
      r.notes ?? "",
      r.workOrderFolio ?? "",
      r.recordFolio ?? "",
    ]),
    rowLimitApplied: truncated,
  }

  const buffer = await buildXlsxBuffer(report)
  const now = todayInChile()
  const filename = `${report.filenameBase}-${now}.xlsx`

  return { buffer, filename, truncated }
}
