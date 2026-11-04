import { sql, type SQL } from "drizzle-orm"
import {
  approvalDecisions, deliveries, deliveryItems, purchaseOrderItems, purchaseOrders,
  purchaseRequestItems, purchaseRequests, receiptItems, receipts,
} from "@/db/schema"
import { issuedOrderPredicate } from "@/lib/services/operational-period-metrics"

/**
 * Los hitos del ciclo de abastecimiento (CHART-029) como fragmentos de SQL, **una sola definición**
 * para dos preguntas que tienen que contestar lo mismo:
 *
 *  - `getSupplyLeadTime` (Analítica): la mediana y el P90 de todos los ítems cerrados del período;
 *  - `getItemLeadTime` (Seguimiento): los días por etapa de **un** ítem.
 *
 * Si cada una armara sus propias fechas, el ítem que Analítica cuenta como «lento» podría verse en su
 * ficha con otros plazos. Todo se evalúa por ítem de solicitud (`purchase_request_items`), que es la
 * fila externa de ambas consultas.
 *
 * **Hitos** (todos en día civil de Chile, que es como se cuentan «días corridos» en el resto del producto):
 *  - envío: `purchase_requests.submitted_at` (texto ISO);
 *  - aprobación: primera decisión `approve`/`modify` del ítem;
 *  - OC: primera emisión de una OC viva que lo contiene (`issuedOrderPredicate`, la misma definición del
 *    tablero), con la línea no anulada;
 *  - llegada: primera recepción **no anulada** con cantidad recibida > 0;
 *  - entrega: primera entrega **no anulada** que lo incluye.
 *
 * Con `supplierId`, la emisión y la llegada se miden **sobre las líneas de ese proveedor**: si el ítem
 * se compró a dos, «cuánto tardó la llegada» sin esta restricción mezclaría proveedores y no diría a
 * quién reclamar. El cierre del ítem (que decide el período) sigue siendo el del ítem completo.
 */

const EPOCH = sql`date '1970-01-01'`

/** Día civil de Chile (desde 1970) de un instante `timestamptz`. */
const instantDay = (instant: SQL) => sql`((${instant} at time zone 'America/Santiago')::date - ${EPOCH})`

/**
 * Un texto de fecha (día o ISO) leído como instante. Un texto que no empieza con una fecha (vacío,
 * basura de una importación) no es un timestamp: sin la guarda el cast reventaría toda la consulta
 * por una sola fila. Misma razón y forma que `approvalAgeDaysSql` (Aprobaciones).
 */
const textInstant = (column: typeof purchaseRequests.submittedAt | typeof purchaseOrders.issuedAt) =>
  sql`(case when ${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then ${column}::timestamptz end)`

export interface LeadTimeMilestoneSql {
  submittedDay: SQL
  approvedDay: SQL
  issuedDay: SQL
  arrivedDay: SQL
  deliveredDay: SQL
  /** Último movimiento del ítem: ubica su cierre en el tiempo. Nunca restringido por proveedor. */
  closedDay: SQL
}

export function leadTimeMilestoneSql(supplierId?: string): LeadTimeMilestoneSql {
  const ofSupplier = supplierId ? sql` and ${purchaseOrders.supplierId} = ${supplierId}` : sql``

  const submittedDay = instantDay(textInstant(purchaseRequests.submittedAt))

  const approvedDay = sql`(select ${instantDay(sql`min(${approvalDecisions.decidedAt})`)} from ${approvalDecisions}
  where ${approvalDecisions.requestItemId} = ${purchaseRequestItems.id} and ${approvalDecisions.type} in ('approve', 'modify'))`

  const issuedDay = sql`(select ${instantDay(sql`min(${textInstant(purchaseOrders.issuedAt)})`)} from ${purchaseOrderItems}
  inner join ${purchaseOrders} on ${purchaseOrders.id} = ${purchaseOrderItems.purchaseOrderId}
  where ${purchaseOrderItems.requestItemId} = ${purchaseRequestItems.id} and ${purchaseOrderItems.status} <> 'cancelled' and ${issuedOrderPredicate()}${ofSupplier})`

  /** Recepciones vigentes del ítem, a través de las líneas de OC que lo cubren. */
  const arrival = (agg: "min" | "max", restrictToSupplier: boolean) => {
    const bySupplier = restrictToSupplier && supplierId
    return sql`(select ${instantDay(sql`${sql.raw(agg)}(${receipts.receivedAt})`)} from ${receiptItems}
  inner join ${receipts} on ${receipts.id} = ${receiptItems.receiptId}
  inner join ${purchaseOrderItems} on ${purchaseOrderItems.id} = ${receiptItems.purchaseOrderItemId}
  ${bySupplier ? sql`inner join ${purchaseOrders} on ${purchaseOrders.id} = ${purchaseOrderItems.purchaseOrderId}` : sql``}
  where ${purchaseOrderItems.requestItemId} = ${purchaseRequestItems.id} and ${receipts.status} <> 'voided' and ${receiptItems.quantityReceived} > 0${bySupplier ? ofSupplier : sql``})`
  }

  const delivery = (agg: "min" | "max") => sql`(select ${instantDay(sql`${sql.raw(agg)}(${deliveries.deliveredAt})`)} from ${deliveryItems}
  inner join ${deliveries} on ${deliveries.id} = ${deliveryItems.deliveryId}
  where ${deliveryItems.requestItemId} = ${purchaseRequestItems.id} and ${deliveries.voidedAt} is null)`

  return {
    submittedDay,
    approvedDay,
    issuedDay,
    arrivedDay: arrival("min", true),
    deliveredDay: delivery("min"),
    closedDay: sql`greatest(${arrival("max", false)}, ${delivery("max")})`,
  }
}
