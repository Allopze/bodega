import { and, inArray, isNull, notInArray } from "drizzle-orm"
import { purchaseOrders } from "@/db/schema"
import { COMPLETED_RECEIPT_ORDER_STATUSES, INVOICE_DUE_ORDER_STATUSES } from "@/lib/work-queue-labels"

/**
 * Qué OC pertenecen a la bandeja de Compras. Dos exclusiones, por razones
 * distintas, y una excepción.
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
 * **Recepción terminada.** Una vez recibida, la OC vive en /recepcion y no
 * vuelve a la bandeja de trabajo de Compras.
 *
 * La excepción es la factura: una OC ya recibida y sin factura sigue siendo
 * trabajo de Compras —la señal "Sin factura" la anunciaba y el listado no podía
 * mostrarla— así que bajo `factura=pendiente` la exclusión de recepción
 * terminada cede el paso a `INVOICE_DUE_ORDER_STATUSES`, que admite `received` y
 * sigue excluyendo `closed`.
 *
 * Ese cambio de acotación va acá y no en el llamador aunque el llamador ya ANDee
 * el mismo `inArray`: si el modo factura sólo relajara la exclusión, el scope
 * dependería de que quien lo use recuerde reponer el límite, y olvidarlo deja
 * entrar las cerradas sin ninguna señal. Acotado acá, el predicado es correcto
 * por sí solo en los dos modos y el llamador sólo agrega lo ortogonal (que la
 * factura falte). La redundancia es un AND del mismo predicado: cuesta nada.
 */
export function comprasInboxSql({ invoicePendingOnly }: { invoicePendingOnly: boolean }) {
  return and(
    isNull(purchaseOrders.deletedAt),
    invoicePendingOnly
      ? inArray(purchaseOrders.status, INVOICE_DUE_ORDER_STATUSES)
      : notInArray(purchaseOrders.status, COMPLETED_RECEIPT_ORDER_STATUSES),
  )
}
