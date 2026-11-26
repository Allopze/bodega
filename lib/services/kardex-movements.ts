import { and, desc, eq, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  inventoryMovements, mantRecords, mantWorkOrders, physicalInventoryCounts, products, stockAdjustments, stockReturns, users, worksites,
} from "@/db/schema"
import { mantRecordOfMovement } from "./stock-mant-reference"

/**
 * Página del kárdex de Bodega (la vista «Movimientos»).
 *
 * El `where` lo arma la página, porque es quien conoce el alcance de faenas de la sesión y los
 * filtros de la URL; se escribe contra `products`, `worksites` e `inventory_movements`, que esta
 * consulta une siempre. Todo lo que cuelga del movimiento sale en la MISMA consulta, con joins y
 * sin consultar de a una fila:
 *  - el folio del documento de bodega (ajuste, devolución, conteo);
 *  - el registro de mantención al que apunta el uso de un repuesto o su reverso, y la OT de ese
 *    registro (`mant_records.work_order_id`).
 */
export async function listKardexMovements(input: { where: SQL | undefined; limit: number; offset: number }) {
  return db
    .select({
      id:             inventoryMovements.id,
      worksiteId:     inventoryMovements.worksiteId,
      productId:      inventoryMovements.productId,
      type:           inventoryMovements.type,
      quantity:       inventoryMovements.quantity,
      stockBefore:    inventoryMovements.stockBefore,
      stockAfter:     inventoryMovements.stockAfter,
      performedAt:    inventoryMovements.performedAt,
      reason:         inventoryMovements.reason,
      notes:          inventoryMovements.notes,
      referenceType:  inventoryMovements.referenceType,
      referenceId:    inventoryMovements.referenceId,
      // Los documentos de bodega llevan su folio en su propia tabla y el uso de un repuesto en el
      // de su registro; el resto (entrega, recepción, guía) lo trae escrito en el motivo o la nota.
      documentFolio:  sql<string | null>`coalesce(${stockAdjustments.code}, ${stockReturns.code}, ${physicalInventoryCounts.code}, ${mantRecords.folio})`,
      recordFolio:    mantRecords.folio,
      workOrderId:    mantWorkOrders.id,
      workOrderFolio: mantWorkOrders.folio,
      productName:    products.name,
      worksiteName:   worksites.name,
      performedByName: users.name,
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .innerJoin(worksites, eq(inventoryMovements.worksiteId, worksites.id))
    .leftJoin(users, eq(inventoryMovements.performedBy, users.id))
    .leftJoin(stockAdjustments, and(
      eq(inventoryMovements.referenceType, "stock_adjustment"),
      eq(stockAdjustments.id, inventoryMovements.referenceId),
    ))
    .leftJoin(stockReturns, and(
      eq(inventoryMovements.referenceType, "delivery_return"),
      eq(stockReturns.id, inventoryMovements.referenceId),
    ))
    .leftJoin(physicalInventoryCounts, and(
      eq(inventoryMovements.referenceType, "physical_inventory_count"),
      eq(physicalInventoryCounts.id, inventoryMovements.referenceId),
    ))
    .leftJoin(mantRecords, mantRecordOfMovement)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantRecords.workOrderId))
    .where(input.where)
    .orderBy(desc(inventoryMovements.performedAt), desc(inventoryMovements.id))
    .limit(input.limit)
    .offset(input.offset)
}

export type KardexMovementRow = Awaited<ReturnType<typeof listKardexMovements>>[number]
