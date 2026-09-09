/**
 * Reconciliación del estado derivado de las solicitudes de compra.
 *
 * `purchase_requests.status` es un derivado del estado de sus ítems, y
 * `rollupRequestStatus` lo recalcula **cuando un ítem transiciona**. Eso deja
 * un hueco: si la regla de derivación cambia, las solicitudes que ya llegaron a
 * un estado terminal de ítems no tienen ninguna transición pendiente que
 * vuelva a dispararla, así que se quedan con el estado que la regla vieja
 * calculó — para siempre.
 *
 * Pasó de verdad: `74adb8c3` (2026-07-04) quitó `received` de la regla de
 * cierre y `0a5bb3f1` (2026-09-02) lo devolvió. Las solicitudes recibidas en
 * esa ventana quedaron en `in_purchasing` con todos sus ítems en `received`, y
 * ninguna transición futura las va a cerrar.
 *
 * Este módulo no reimplementa la regla: usa `deriveRequestStatus`, el mismo
 * dueño que usa el rollup. Una segunda opinión sobre cuándo cierra una
 * solicitud es exactamente el problema que esto viene a arreglar.
 */
import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems } from "@/db/schema"
import { deriveRequestStatus, lockRequestsForRollupTx, rollupRequestStatus } from "./item-state-module/rollup"

/**
 * Estados del padre que el rollup puede reescribir. Es la misma lista que la
 * guarda del `UPDATE` en `rollupRequestStatus`: `draft` todavía no se envió y
 * `cancelled` es terminal por decisión (F1-1/F1-2), así que informar deriva
 * sobre ellos sería informar algo que no se puede ni se debe arreglar.
 */
const RECONCILABLE_STATUSES = [
  "submitted", "in_review", "partially_approved", "approved",
  "rejected", "in_purchasing", "closed",
] as const

export interface RequestStatusDrift {
  requestId: string
  code: string
  /** Estado que tiene hoy la solicitud. */
  current: string
  /** Estado que la regla vigente deriva de sus ítems. */
  expected: string
  itemStatuses: string[]
}

export interface RequestStatusReconciliationSummary {
  scanned: number
  reconciled: number
  dryRun: boolean
  drifts: RequestStatusDrift[]
}

/** Solicitudes cuyo estado guardado no coincide con el que deriva la regla. */
export async function findRequestStatusDrift(): Promise<{ scanned: number; drifts: RequestStatusDrift[] }> {
  const requests = await db
    .select({ id: purchaseRequests.id, code: purchaseRequests.code, status: purchaseRequests.status })
    .from(purchaseRequests)
    .where(inArray(purchaseRequests.status, [...RECONCILABLE_STATUSES]))

  if (requests.length === 0) return { scanned: 0, drifts: [] }

  const items = await db
    .select({ requestId: purchaseRequestItems.requestId, status: purchaseRequestItems.status })
    .from(purchaseRequestItems)
    .where(inArray(purchaseRequestItems.requestId, requests.map((request) => request.id)))

  const byRequest = new Map<string, string[]>()
  for (const item of items) {
    const bucket = byRequest.get(item.requestId)
    if (bucket) bucket.push(item.status)
    else byRequest.set(item.requestId, [item.status])
  }

  const drifts: RequestStatusDrift[] = []
  for (const request of requests) {
    const statuses = byRequest.get(request.id)
    // Sin ítems no hay nada que derivar, igual que en el rollup.
    if (!statuses || statuses.length === 0) continue
    const expected = deriveRequestStatus(statuses)
    if (expected === request.status) continue
    drifts.push({
      requestId: request.id,
      code: request.code,
      current: request.status,
      expected,
      itemStatuses: [...new Set(statuses)].sort(),
    })
  }

  return { scanned: requests.length, drifts }
}

/**
 * Recalcula el estado de las solicitudes que quedaron desfasadas.
 *
 * `dryRun` es el valor por omisión: informa la deriva sin escribir. Al aplicar
 * delega en `rollupRequestStatus` —no escribe por su cuenta— y respeta su
 * contrato de lockeo (`lockRequestsForRollupTx` antes de la primera mutación),
 * así que corre sin trabarse contra una transición de ítem concurrente y deja
 * el mismo rastro en `status_history` que cualquier otra transición.
 */
export async function reconcileRequestStatuses(
  options: { dryRun?: boolean; userId?: string | null } = {},
): Promise<RequestStatusReconciliationSummary> {
  const dryRun = options.dryRun ?? true
  // `null` y no un id de sistema: `status_history.changed_by` tiene FK a
  // `users`, así que un id inventado revienta la inserción. Es nullable justo
  // para las transiciones que no dispara una persona.
  const changedBy = options.userId ?? null
  const { scanned, drifts } = await findRequestStatusDrift()

  if (dryRun || drifts.length === 0) {
    return { scanned, reconciled: 0, dryRun, drifts }
  }

  let reconciled = 0
  for (const drift of drifts) {
    await db.transaction(async (tx) => {
      await lockRequestsForRollupTx(tx, [drift.requestId])
      await rollupRequestStatus(drift.requestId, tx, changedBy)
    })
    reconciled++
  }

  return { scanned, reconciled, dryRun, drifts }
}
