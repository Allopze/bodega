import { eq, and, inArray } from "drizzle-orm"
import { type Tx } from "@/db"
import { purchaseRequests, purchaseRequestItems } from "@/db/schema"
import { recordStatusChange } from "@/lib/audit"

/**
 * Roll up purchase request status based on current item statuses.
 * Called inside transactions after each item transition.
 *
 * DAT-1 (conocido, no resuelto): sin lock, dos mutaciones concurrentes de
 * ítems distintos de la misma solicitud pueden leer hermanos sin commitear y
 * dejar el padre en un estado obsoleto — reproducido de forma confiable
 * contra Postgres real (dos aprobaciones concurrentes dejan el padre en
 * 'in_review' con cero ítems pendientes). Se auto-corrige en la siguiente
 * transición sobre la misma solicitud; hasta entonces la UI muestra un
 * estado derivado incorrecto (los ítems en sí nunca quedan mal).
 *
 * Dos intentos de arreglo se probaron contra Postgres real y ambos
 * fallaron — documentado para no repetirlos sin la re-derivación completa:
 *  1. `SELECT ... FOR UPDATE` sobre el padre al inicio de esta función:
 *     deadlockea. `approveItem`/`rejectItem` insertan en `approval_decisions`
 *     (FK a `purchase_requests`) ANTES de llegar aquí, lo que toma un lock
 *     débil (FOR KEY SHARE) sobre el padre; dos transacciones que ya tienen
 *     esa lock débil e intentan subir a FOR UPDATE al mismo tiempo se traban
 *     entre sí (error 40P01, reproducido en
 *     `lib/__tests__/rollup-concurrency-postgres.test.ts`).
 *  2. UPDATE atómico con el estado recalculado en una subquery dentro del
 *     mismo SET (sin lock nuevo): tampoco alcanza. Cuando el UPDATE se
 *     bloquea esperando la fila del padre y luego se desbloquea, Postgres
 *     sólo refresca la fila objetivo (EvalPlanQual) — las subqueries contra
 *     `purchase_request_items` siguen usando el snapshot de antes de
 *     bloquearse, así que ven el ítem hermano todavía sin commitear.
 *
 * Una solución real existe (mover el lock del padre a ANTES del insert en
 * `approval_decisions`/`status_history`, en cada uno de los ~8 callers), pero
 * es un cambio mucho más grande que este fix puntual — pendiente como deuda
 * conocida, no como bug silencioso.
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
  const anyApproved   = statuses.some((s) => ["approved", "pending_purchase", "in_purchase_order", "purchased", "partially_received", "received", "partially_delivered", "delivered"].includes(s))
  const allRejected   = statuses.every((s) => s === "rejected")
  const allClosed     = statuses.every((s) => ["rejected", "delivered"].includes(s))
  const anyPurchasing = statuses.some((s) => ["in_purchase_order", "purchased", "partially_received", "received", "partially_delivered"].includes(s))
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
       "partially_received", "received", "partially_delivered", "delivered",
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
