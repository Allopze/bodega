/**
 * Fuente única de verdad de "ítem aprobado que todavía no está en ninguna OC".
 *
 * Es la cola de trabajo del módulo Compras: la pregunta que ese módulo tiene
 * que responder es "¿qué solicitudes ya se aprobaron y todavía necesitan una
 * OC?". La respuesta no es un estado nuevo — se deriva de dos hechos que ya
 * existen: el ítem está aprobado, y ninguna línea de OC activa lo cubre.
 *
 * Vivía escrita cuatro veces (el contador de /compras, el selector de
 * /compras/nueva, la fuente `create_order` de la cola operacional y su badge)
 * y sólo el selector aplicaba la cobertura. Esa asimetría es visible: al
 * cerrar una OC con una línea nunca recibida, `closeOrderTx` devuelve el ítem
 * a `pending_purchase` — el contador lo contaba y el selector lo escondía, así
 * que la bandeja anunciaba "1 ítem aprobado sin incluir en ninguna OC" y
 * "Crear OC" rebotaba con "no hay ítems pendientes". Un solo predicado
 * compartido cierra esa divergencia por construcción.
 *
 * El llamador debe tener `purchase_request_items` y `purchase_requests` en el
 * FROM (la guarda de solicitud terminal se aplica sobre el padre).
 */

import { and, inArray, notInArray, sql, type SQL } from "drizzle-orm"
import { purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { TERMINAL_REQUEST_STATUSES } from "@/lib/approvals-queue"

/**
 * Los dos estados de ítem que significan "aprobado y todavía comprable".
 * `approved` lo produce Aprobaciones; `pending_purchase` lo produce el retorno
 * desde una OC anulada o cerrada sin recibir.
 */
export const PENDING_PURCHASE_ITEM_STATUSES = ["approved", "pending_purchase"] as const

/**
 * Ninguna línea de OC activa cubre este ítem.
 *
 * "Activa" es exactamente el mismo criterio que `getPurchasableCoverage` usa en
 * memoria y `activePurchaseCoverageWhere` en SQL: la línea no está anulada, su
 * OC no está anulada y la OC no está eliminada (soft delete). Una OC cerrada
 * SÍ cuenta como cobertura activa mientras sus líneas sigan en `issued`; la
 * contrapartida es que al cerrar sin recibir esas líneas se anulan
 * (`closeOrderTx`), que es lo que devuelve el ítem a la cola.
 */
export const itemHasNoActiveOrderSql = sql`NOT EXISTS (
  SELECT 1
  FROM purchase_order_items poi
  JOIN purchase_orders po ON po.id = poi.purchase_order_id
  WHERE poi.request_item_id = ${purchaseRequestItems.id}
    AND poi.status <> 'cancelled'
    AND po.status <> 'cancelled'
    AND po.deleted_at IS NULL
)`

/**
 * El predicado completo de la cola de Compras. `extra` recibe el scope de faena
 * y los filtros de la pantalla; se omite cuando no hay ninguno.
 */
export function pendingPurchaseWhere(...extra: Array<SQL | undefined>): SQL | undefined {
  return and(
    inArray(purchaseRequestItems.status, [...PENDING_PURCHASE_ITEM_STATUSES]),
    // Una solicitud terminal no genera trabajo pendiente por más que a alguno
    // de sus ítems le haya quedado un estado intermedio (A-03/A-13).
    notInArray(purchaseRequests.status, [...TERMINAL_REQUEST_STATUSES]),
    itemHasNoActiveOrderSql,
    ...extra,
  )
}
