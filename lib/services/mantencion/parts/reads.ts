/**
 * Lecturas de reservas para las vistas (app, OT web, Bodega). Sin bloqueos.
 */

import { and, asc, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantPartsAllocations, products, worksites } from "@/db/schema"
import { requiresWholeQuantity } from "@/lib/utils"
import { remainingSql, reservedByStockKeyTx, roundQty, toCents } from "@/lib/services/stock-reservations"
import type { WorkOrderAvailablePart } from "./types"

type Reader = Pick<Tx, "select">

/** Repuestos reservados y sin usar de las OT indicadas (chips «Disponibles para esta OT»). */
export async function listAvailableForWorkOrders(workOrderIds: readonly string[], client: Reader = db): Promise<WorkOrderAvailablePart[]> {
  if (workOrderIds.length === 0) return []
  const rows = await client
    .select({
      allocationId: mantPartsAllocations.id,
      workOrderId: mantPartsAllocations.workOrderId,
      productId: mantPartsAllocations.productId,
      name: products.name,
      partNumber: products.partNumber,
      unit: products.unitOfMeasure,
      worksiteId: mantPartsAllocations.worksiteId,
      worksiteName: worksites.name,
      remaining: remainingSql,
    })
    .from(mantPartsAllocations)
    .innerJoin(products, eq(products.id, mantPartsAllocations.productId))
    .innerJoin(worksites, eq(worksites.id, mantPartsAllocations.worksiteId))
    .where(and(inArray(mantPartsAllocations.workOrderId, [...workOrderIds]), eq(mantPartsAllocations.status, "activa")))
    .orderBy(asc(products.name))
  return rows
    .map((row) => ({ ...row, remaining: roundQty(Number(row.remaining)), wholeOnly: requiresWholeQuantity(row.unit) }))
    .filter((row) => toCents(row.remaining) > 0)
}

/** Reservado por (faena, producto), para las columnas «Reservado OT» y «Libre» de Bodega. */
export function stockReservationSummary(
  filters: { worksiteIds?: readonly string[]; productIds?: readonly string[] } = {},
  client: Reader = db,
) {
  return reservedByStockKeyTx(client, filters)
}
