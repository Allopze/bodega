/**
 * Stock and kardex Excel export functions.
 */

import { eq, and, sql, inArray } from "drizzle-orm"
import { db } from "@/db"
import { worksites, worksiteStock, inventoryMovements, products, users } from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { buildXlsxBuffer, type ReportData } from "@/lib/reports/export"
import type { Session } from "next-auth"
import { todayInChile } from "@/lib/utils"

export interface StockExportFilters {
  worksiteId?: string
}

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ingreso_oc:            "Ingreso OC",
  egreso_entrega:        "Entrega",
  ingreso_devolucion:    "Devolución",
  egreso_desecho:        "Retiro",
  ajuste:                "Ajuste",
  egreso_traslado:       "Salida por guía",
  ingreso_traslado:      "Ingreso por guía",
  retiro_epp_trabajador: "Retiro EPP usado",
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
      quantity:       worksiteStock.quantity,
      minStock:       worksiteStock.minStock,
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

  const report: ReportData = {
    filenameBase: "stock-por-faena",
    worksheetName: "Stock",
    headers: [
      "Faena",
      "Producto",
      "SKU",
      "U/M",
      "Cantidad",
      "Stock mínimo",
      "Último movimiento",
    ],
    rows: limited.map((r) => [
      r.worksiteName,
      r.productName,
      r.productSku ?? "",
      r.unitOfMeasure,
      r.quantity,
      r.minStock,
      r.lastMovementAt ?? "",
    ]),
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

  const rows = await db
    .select({
      id:              inventoryMovements.id,
      worksiteId:      inventoryMovements.worksiteId,
      worksiteName:    worksites.name,
      productId:       inventoryMovements.productId,
      productName:     products.name,
      productSku:      products.sku,
      type:            inventoryMovements.type,
      quantity:        inventoryMovements.quantity,
      stockBefore:     inventoryMovements.stockBefore,
      stockAfter:      inventoryMovements.stockAfter,
      performedAt:     inventoryMovements.performedAt,
      performedByName: users.name,
      reason:          inventoryMovements.reason,
      notes:           inventoryMovements.notes,
    })
    .from(inventoryMovements)
    .innerJoin(worksites, eq(inventoryMovements.worksiteId, worksites.id))
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .innerJoin(users, eq(inventoryMovements.performedBy, users.id))
    .where(and(wsScope, wsFilter, prodFilter))
    .orderBy(sql`${inventoryMovements.performedAt} DESC`)
    .limit(maxRows + 1)

  const truncated = rows.length > maxRows
  const limited = truncated ? rows.slice(0, maxRows) : rows

  const report: ReportData = {
    filenameBase: "kardex-movimientos",
    worksheetName: "Kardex",
    headers: [
      "Fecha",
      "Faena",
      "Producto",
      "SKU",
      "Tipo de movimiento",
      "Cantidad",
      "Stock anterior",
      "Stock posterior",
      "Responsable",
      "Motivo",
      "Observaciones",
    ],
    rows: limited.map((r) => [
      r.performedAt ?? "",
      r.worksiteName,
      r.productName,
      r.productSku ?? "",
      MOVEMENT_TYPE_LABELS[r.type] ?? r.type,
      r.quantity,
      r.stockBefore,
      r.stockAfter,
      r.performedByName,
      r.reason ?? "",
      r.notes ?? "",
    ]),
    rowLimitApplied: truncated,
  }

  const buffer = await buildXlsxBuffer(report)
  const now = todayInChile()
  const filename = `${report.filenameBase}-${now}.xlsx`

  return { buffer, filename, truncated }
}
