import { eq, and, inArray } from "drizzle-orm"
import { type Tx } from "@/db"
import { purchaseRequests, purchaseRequestItems } from "@/db/schema"
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
  changedBy: string,
): Promise<void> {
  const [current] = await tx
    .select({ status: purchaseRequests.status })
    .from(purchaseRequests)
    .where(eq(purchaseRequests.id, requestId))
  if (!current) return

  const items = await tx
    .select({ status: purchaseRequestItems.status })
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.requestId, requestId))

  if (items.length === 0) return

  const statuses = items.map((i) => i.status)

  const pendingReview = ["requested"].some((s) => statuses.includes(s))
  const anyApproved   = statuses.some((s) => ["approved", "pending_purchase", "in_purchase_order", "purchased", "partially_office_received", "office_received", "partially_received", "received", "partially_delivered", "delivered"].includes(s))
  const allRejected   = statuses.every((s) => s === "rejected")
  const allClosed     = statuses.every((s) => ["rejected", "delivered"].includes(s))
  const anyPurchasing = statuses.some((s) => ["in_purchase_order", "purchased", "partially_office_received", "office_received", "partially_received", "received", "partially_delivered"].includes(s))
  const allResolved   = !pendingReview

  let newStatus: string
  if (pendingReview) {
    newStatus = "in_review"
  } else if (allRejected) {
    newStatus = "rejected"
  } else if (allClosed) {
    newStatus = "closed"
  } else if (anyPurchasing) {
    newStatus = "in_purchasing"
  } else if (allResolved && anyApproved) {
    const allApprovedOrBeyond = statuses.every((s) =>
      ["approved", "pending_purchase", "in_purchase_order", "purchased",
       "partially_office_received", "office_received", "partially_received", "received", "partially_delivered", "delivered",
       "rejected"].includes(s)
    )
    newStatus = allApprovedOrBeyond ? "approved" : "partially_approved"
  } else if (allResolved) {
    newStatus = "partially_approved"
  } else {
    newStatus = "in_review"
  }

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
