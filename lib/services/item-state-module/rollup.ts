import { eq, and, inArray, sql } from "drizzle-orm"
import { type Tx } from "@/db"
import { purchaseRequests, purchaseRequestItems, purchaseOrderItems } from "@/db/schema"
import { recordStatusChange } from "@/lib/audit"

/**
 * Lockea las solicitudes cuyo estado derivado va a recalcular `rollupRequestStatus`.
 *
 * Es la mitad que faltaba de DAT-1. El rollup lee los ítems hermanos para
 * derivar el estado del padre; sin serializar a los escritores, dos
 * transacciones sobre ítems distintos de la misma solicitud leen cada una un
 * hermano sin commitear y la última en escribir deja al padre obsoleto.
 *
 * **Dónde va la llamada:** después de lockear los ítems y ANTES de la primera
 * mutación o de cualquier INSERT que referencie al padre. Ese "antes" no es
 * estilo: `approval_decisions.request_id` tiene FK a `purchase_requests`, así
 * que insertarlo primero toma un FOR KEY SHARE sobre el padre, y dos
 * transacciones que ya lo tienen e intentan subir a FOR UPDATE se deadlockean
 * (40P01). Ese fue el primer intento fallido de arreglo; tomar el lock fuerte
 * antes del insert lo evita porque nunca hay que subir de nivel.
 *
 * **Orden:** ítems primero, padre después — el mismo que ya usa `cancelRequest`
 * (DAT-2). Entre solicitudes, orden lexicográfico, para que dos consolidados
 * que tocan las mismas dos solicitudes en distinto orden se serialicen en vez
 * de trabarse.
 */
export async function lockRequestsForRollupTx(
  tx: Tx,
  requestIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(requestIds.filter((id): id is string => Boolean(id)))]
    .sort((a, b) => a.localeCompare(b))
  if (ids.length === 0) return

  await tx
    .select({ id: purchaseRequests.id })
    .from(purchaseRequests)
    .where(inArray(purchaseRequests.id, ids))
    .orderBy(purchaseRequests.id)
    .for("update")
}

/** Ítem de la solicitud, con lo justo para derivar el estado del padre. */
export interface RollupItem {
  status: string
  /**
   * `true` cuando las cantidades muestran que el ítem llegó completo a faena
   * (`sum(purchase_order_items.quantity_received) >= purchase_request_items.quantity`).
   *
   * Hace falta porque `partially_delivered` es ambiguo: se alcanza desde
   * `received` (llegó todo, se repartió parte) y desde `partially_received`
   * (llegó parte, se repartió parte), y al recibir el saldo **conserva** ese
   * estado (`receiving.ts`). El estado solo no distingue los dos casos.
   */
  fullyReceived: boolean
}

/**
 * Estado derivado de una solicitud a partir del de sus ítems.
 *
 * Función pura y exportada para que el reconciliador de estados
 * (`lib/services/request-status-reconciliation.ts`) pueda calcular el estado
 * esperado sin escribir, y lo haga con **esta** regla en vez de una segunda
 * opinión sobre cuándo cierra una solicitud. Su cobertura vive en
 * `rollup.test.ts`; antes estaba embebida acá y no se podía comprobar sola.
 */
export function deriveRequestStatus(items: readonly RollupItem[]): string {
  const statuses = items.map((item) => item.status)
  const pendingReview = ["requested"].some((s) => statuses.includes(s))
  const anyApproved   = statuses.some((s) => ["approved", "pending_purchase", "in_purchase_order", "purchased", "partially_office_received", "office_received", "partially_received", "received", "partially_delivered", "delivered"].includes(s))
  const allRejected   = statuses.every((s) => s === "rejected")
  // La adquisición termina cuando el ítem llegó completo a faena (`received`).
  // `delivered` queda soportado para solicitudes antiguas y para el vínculo
  // explícito de una entrega a trabajador; esa distribución es posterior y no
  // debe ser requisito para cerrar la compra.
  // `partially_delivered` cierra sólo cuando la cantidad confirma la llegada
  // completa: la distribución al trabajador es posterior a la adquisición y no
  // debe ser requisito, pero un saldo en tránsito sí lo es. SOL-0027 (3 pedidas,
  // 2 en faena) es el caso que esto mantiene abierto.
  const allClosed     = items.every((item) =>
    ["rejected", "received", "delivered"].includes(item.status)
    || (item.status === "partially_delivered" && item.fullyReceived))
  const anyPurchasing = statuses.some((s) => ["in_purchase_order", "purchased", "partially_office_received", "office_received", "partially_received", "received", "partially_delivered"].includes(s))
  const allResolved   = !pendingReview

  if (pendingReview) return "in_review"
  if (allRejected) return "rejected"
  if (allClosed) return "closed"
  if (anyPurchasing) return "in_purchasing"
  if (allResolved && anyApproved) {
    const allApprovedOrBeyond = statuses.every((s) =>
      ["approved", "pending_purchase", "in_purchase_order", "purchased",
       "partially_office_received", "office_received", "partially_received", "received", "partially_delivered", "delivered",
       "rejected"].includes(s)
    )
    return allApprovedOrBeyond ? "approved" : "partially_approved"
  }
  if (allResolved) return "partially_approved"
  return "in_review"
}

/**
 * Roll up purchase request status based on current item statuses.
 * Called inside transactions after each item transition.
 *
 * **DAT-1, cerrado.** Esta función NO lockea: la serialización la aporta el
 * caller con `lockRequestsForRollupTx`, tomado después de los ítems y antes de
 * la primera mutación. Todo caller que llegue hasta acá tiene que haberlo
 * llamado; si aparece uno nuevo que no lo haga, vuelve la carrera —el padre
 * queda en un estado derivado obsoleto hasta la siguiente transición— y la
 * cubre `lib/__tests__/rollup-concurrency-postgres.test.ts`.
 *
 * Por qué el lock vive en el caller y no acá, que es lo que se intentó dos
 * veces y falló (documentado para no repetirlo):
 *  1. `SELECT ... FOR UPDATE` sobre el padre al inicio de ESTA función:
 *     deadlockea. `approveItem`/`rejectItem` insertan en `approval_decisions`
 *     (FK a `purchase_requests`) antes de llegar aquí, lo que toma un lock
 *     débil (FOR KEY SHARE) sobre el padre; dos transacciones que ya lo tienen
 *     e intentan subir a FOR UPDATE se traban entre sí (40P01). Tomándolo
 *     antes del insert nunca hay que subir de nivel, que es justamente lo que
 *     hace `lockRequestsForRollupTx` en su sitio correcto.
 *  2. UPDATE atómico con el estado recalculado en una subquery dentro del
 *     mismo SET (sin lock nuevo): tampoco alcanza. Cuando el UPDATE se
 *     bloquea esperando la fila del padre y luego se desbloquea, Postgres
 *     sólo refresca la fila objetivo (EvalPlanQual) — las subqueries contra
 *     `purchase_request_items` siguen usando el snapshot de antes de
 *     bloquearse, así que ven el ítem hermano todavía sin commitear.
 */
export async function rollupRequestStatus(
  requestId: string,
  tx: Tx,
  /**
   * `null` cuando la transición no la dispara una persona: el reconciliador de
   * estados corre en el deploy y no tiene usuario. `status_history.changed_by`
   * es nullable con FK a `users`, así que inventar un id de sistema violaría la
   * FK — es lo que hace `epp-delivery-scale-reconciliation` con su `userId`.
   */
  changedBy: string | null,
): Promise<void> {
  const [current] = await tx
    .select({ status: purchaseRequests.status })
    .from(purchaseRequests)
    .where(eq(purchaseRequests.id, requestId))
  if (!current) return

  // La cantidad recibida se agrega desde las líneas de OC: `partially_delivered`
  // no dice si quedó saldo en tránsito, y sin eso el padre no se puede cerrar
  // sin arriesgar cerrar una compra incompleta.
  const items = await tx
    .select({
      status: purchaseRequestItems.status,
      quantity: purchaseRequestItems.quantity,
      received: sql<number>`coalesce(sum(${purchaseOrderItems.quantityReceived}), 0)`,
    })
    .from(purchaseRequestItems)
    .leftJoin(purchaseOrderItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id))
    .where(eq(purchaseRequestItems.requestId, requestId))
    .groupBy(purchaseRequestItems.id, purchaseRequestItems.status, purchaseRequestItems.quantity)

  if (items.length === 0) return

  const newStatus = deriveRequestStatus(items.map((item) => ({
    status: item.status,
    fullyReceived: Number(item.received) >= item.quantity,
  })))

  // `cancelled` es terminal para el padre (F1-1/F1-2: cancelar rechaza TODOS
  // los ítems abiertos, así que ninguna transición de ítem puede volver a
  // dispararse ahí); `returned` está retirado del flujo desde 2026-08-07.
  // Sacarlos de aquí cierra la resurrección de solicitudes canceladas
  // (LOG-2/DAT-2) por construcción, en vez de depender de un chequeo aparte.
  const now = new Date().toISOString()
  const [updated] = await tx
    .update(purchaseRequests)
    .set({ status: newStatus, updatedAt: now })
    .where(
      and(
        eq(purchaseRequests.id, requestId),
        inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved", "approved", "rejected", "in_purchasing", "closed"]),
      ),
    )
    .returning({ id: purchaseRequests.id })

  // DAT-10: sólo se traza si la fila realmente cambió (la guarda de arriba
  // pudo no aplicar) y si el estado derivado es distinto del que ya tenía —
  // el rollup corre después de cada transición de ítem, así que la mayoría
  // de las veces no hay cambio de padre que anunciar.
  if (updated && newStatus !== current.status) {
    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   requestId,
      fromStatus: current.status,
      toStatus:   newStatus,
      changedBy,
    }, tx)
  }
}
