/**
 * `APR-002` (auditoría 2026-09-14): avisar al solicitante también cuando la
 * aprobación fue masiva.
 *
 * La aprobación individual (`approveItemAction`) leía el solicitante antes de
 * mutar y, tras el commit, le mandaba una notificación `request_approved`. La
 * acción masiva —«Aprobar todos» y la barra «Aprobar N», que es justamente lo
 * que la interfaz recomienda para un grupo completo— validaba, aprobaba y
 * terminaba en revalidación: ni cargaba solicitantes ni emitía nada. El mismo
 * hecho de negocio avisaba o no según el gesto del aprobador, y quien pidió el
 * material seguía haciendo seguimiento a mano.
 *
 * FORMA. Es la misma de `requester-shortfall-notify.ts`: el destinatario y el
 * texto se resuelven **dentro** de la transacción —es ahí donde se puede leer
 * `purchase_requests.requester_id` bajo el mismo lock que la aprobación— y se
 * emiten **después del commit**, para que un ROLLBACK no deje avisado a nadie
 * de una aprobación que no ocurrió.
 *
 * AGRUPACIÓN. Un aviso por solicitud, no por ítem: un lote de ocho líneas de la
 * misma solicitud es un solo hecho para quien la pidió. Y un lote que cruza
 * solicitudes produce un aviso por cada una, a su propio solicitante: nunca se
 * mezclan destinatarios.
 */

import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { notifyAfterCommit, notifyManyUser } from "./notifications"
import type { PendingRequesterNotification } from "./requester-shortfall-notify"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type { PendingRequesterNotification }

/**
 * Resuelve los avisos de aprobación de una tanda de ítems ya aprobados.
 *
 * Devuelve las notificaciones listas para emitir; no las emite. El caller las
 * suelta con `flushRequesterApprovalNotifications` una vez commiteada la
 * transacción de negocio.
 */
export async function collectBulkApprovalNoticesTx(
  tx: Tx,
  itemIds: string[],
  opts?: { approverName?: string },
): Promise<PendingRequesterNotification[]> {
  const uniqueItemIds = [...new Set(itemIds)].filter(Boolean)
  if (uniqueItemIds.length === 0) return []

  const rows = await tx
    .select({
      itemId: purchaseRequestItems.id,
      requestId: purchaseRequests.id,
      requestCode: purchaseRequests.code,
      requesterId: purchaseRequests.requesterId,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(inArray(purchaseRequestItems.id, uniqueItemIds))

  // Agrupación por solicitud: el aviso habla de la solicitud, no de la línea.
  const byRequest = new Map<string, { code: string; requesterId: string; itemIds: string[] }>()
  for (const row of rows) {
    if (!row.requesterId) continue
    const group = byRequest.get(row.requestId)
    if (group) group.itemIds.push(row.itemId)
    else byRequest.set(row.requestId, { code: row.requestCode, requesterId: row.requesterId, itemIds: [row.itemId] })
  }

  const approver = opts?.approverName?.trim()
  const notices: PendingRequesterNotification[] = []
  for (const [requestId, group] of byRequest) {
    const count = group.itemIds.length
    notices.push({
      userIds: [group.requesterId],
      input: {
        type: "request_approved",
        title: count === 1
          ? `Ítem aprobado en ${group.code}`
          : `${count} ítems aprobados en ${group.code}`,
        body: approver
          ? `Aprobado por ${approver}. Ya está disponible para Compras.`
          : "Aprobado. Ya está disponible para Compras.",
        entityType: "purchase_request",
        entityId: requestId,
        entityHref: `/solicitudes/${requestId}`,
        // La llave es el conjunto de ítems aprobados: un reintento del MISMO
        // lote no vuelve a avisar, y una aprobación posterior de otras líneas
        // de la misma solicitud sí produce su propio aviso.
        dedupeKey: `aprobacion-lote:${requestId}:${[...group.itemIds].sort().join(",")}`,
      },
    })
  }

  return notices
}

/**
 * Emite los avisos después del commit. Fire-and-forget: `notifyManyUser` traga
 * y loguea cualquier error, así que un aviso caído nunca tumba una aprobación
 * ya commiteada.
 */
export function flushRequesterApprovalNotifications(notices: PendingRequesterNotification[]): void {
  const emitted = new Set<string>()
  for (const notice of notices) {
    for (const userId of notice.userIds) {
      const key = notice.input.dedupeKey ? `${userId}|${notice.input.dedupeKey}` : null
      if (key) {
        if (emitted.has(key)) continue
        emitted.add(key)
      }
      notifyAfterCommit(() => notifyManyUser([userId], notice.input))
    }
  }
}
