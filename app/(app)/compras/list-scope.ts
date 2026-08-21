import { and, inArray, isNull } from "drizzle-orm"
import { purchaseOrders } from "@/db/schema"
import { COMPLETED_RECEIPT_ORDER_STATUSES } from "@/lib/work-queue-labels"
import { orderNeedsInvoiceWork } from "@/lib/services/operational-work-queue"

/**
 * Qué OC pertenecen a la bandeja de Compras.
 *
 * Compras conserva sólo el trabajo de abastecimiento (borradores) y su
 * historial de anuladas. Una OC emitida pasa a ser responsabilidad de
 * Recepción mientras tenga cualquier saldo físico pendiente; esos estados no
 * deben volver a aparecer en esta bandeja.
 *
 * **Eliminadas.** `deleteOrder` no borra la fila: le pone `deletedAt` y le muta
 * el código a `OC-…-DELETED-<id>` para liberar el UNIQUE. Sin este corte el
 * listado mostraba ese código interno en pantalla, lo contaba en "Todas" y
 * llenaba la tab "Anuladas" con eliminadas en vez de con las anuladas de verdad
 * (`cancelOrder` conserva el código y no marca `deletedAt`). Es el mismo corte
 * que DAT-16 le puso al export de gasto por faena por este mismo motivo; el
 * listado se había quedado sin él. Vive acá, y no inline en la página, para que
 * el próximo consumidor lo reutilice en vez de reinventarlo por tercera vez.
 *
 * **Factura pendiente.** Una OC cuya recepción ya terminó puede volver sólo
 * bajo `factura=pendiente`: recibir sin factura sigue siendo trabajo de
 * Compras. Las OC con recepción activa quedan fuera incluso en ese modo.
 *
 * El predicado vive aquí y no en el llamador para que ambos modos respeten la
 * misma frontera de módulo.
 */
export function comprasInboxSql({ invoicePendingOnly }: { invoicePendingOnly: boolean }) {
  return and(
    isNull(purchaseOrders.deletedAt),
    invoicePendingOnly
      ? and(
          inArray(purchaseOrders.status, COMPLETED_RECEIPT_ORDER_STATUSES),
          orderNeedsInvoiceWork,
        )
      : inArray(purchaseOrders.status, ["draft", "cancelled"]),
  )
}
