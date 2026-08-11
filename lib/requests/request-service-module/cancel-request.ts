import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { resolveReplenishmentLinksTx } from "@/lib/services/epp-replenishment"
import { isRequestCancellable } from "@/lib/services/requests-cancel.constants"
import type { RequestModuleConfig } from "../request-config"

const LOCKED_ITEM_STATUSES = ["in_purchase_order", "purchased", "partially_received", "received", "partially_delivered", "delivered"]
const REJECTABLE_ITEM_STATUSES = ["draft", "requested", "approved", "pending_purchase"]

type LoadedRequest = { id: string; status: string; code: string; requestType: string }

function assertCancellable(request: LoadedRequest, reason: string): void {
  if (!isRequestCancellable(request.status)) {
    throw new Error(`No se puede cancelar una solicitud en estado '${request.status}'`)
  }
  if (request.status !== "draft" && !reason?.trim()) {
    throw new Error("El motivo de cancelación es obligatorio")
  }
}

/**
 * Cancela una solicitud: implementación única para los dos caminos que hoy
 * llegan aquí (repuestos/servicios vía el factory, EPP/otro vía
 * solicitudes/actions-module/cancel.ts). Antes divergían (LOG-3): una dejaba
 * ítems abiertos bajo un padre `cancelled`, la otra no fijaba `closedAt`, y
 * ninguna lockeaba antes de decidir (DAT-2/DAT-6 — TOCTOU con la creación de
 * una OC sobre el mismo ítem).
 *
 * Orden de locks — ítems primero, padre después: es el mismo orden que
 * approveItem/rejectItem/receiveItemTx ya usan (lockean el ítem y solo al
 * final, vía rollupRequestStatus, tocan el padre). Si esta función lockeara el
 * padre primero, una cancelación y una aprobación concurrentes sobre la misma
 * solicitud podrían deadlockearse (DAT-1/F1-6). La lectura inicial del padre
 * es sin lock, solo para un mensaje de error rápido; la validación que manda
 * es la de después de lockear todo.
 */
export async function cancelRequest(
  requestId: string,
  userId: string,
  reason: string,
  opts?: { userEmail?: string; requestType?: RequestModuleConfig["requestType"] },
): Promise<{ rejectedItemIds: string[] }> {
  return db.transaction(async (tx) => {
    const requestFilter = and(
      eq(purchaseRequests.id, requestId),
      opts?.requestType ? eq(purchaseRequests.requestType, opts.requestType) : undefined,
    )

    const [precheck] = await tx.select().from(purchaseRequests).where(requestFilter)
    if (!precheck) throw new Error("Solicitud no encontrada")
    assertCancellable(precheck, reason)

    const items = await tx
      .select({ id: purchaseRequestItems.id, status: purchaseRequestItems.status })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.requestId, requestId))
      .orderBy(purchaseRequestItems.id)
      .for("update")

    if (items.some((item) => LOCKED_ITEM_STATUSES.includes(item.status))) {
      throw new Error("No se puede cancelar: la solicitud ya tiene ítems en compra, recepción o entrega")
    }

    // Recién ahora se lockea el padre — después de los ítems — y se
    // re-valida: el precheck de arriba pudo quedar obsoleto mientras
    // esperábamos los locks de los ítems.
    const [request]: LoadedRequest[] = await tx
      .select()
      .from(purchaseRequests)
      .where(requestFilter)
      .for("update")
    if (!request) throw new Error("Solicitud no encontrada")
    assertCancellable(request, reason)

    const now = new Date().toISOString()
    const itemIdsToReject = items.filter((item) => REJECTABLE_ITEM_STATUSES.includes(item.status)).map((item) => item.id)

    if (itemIdsToReject.length > 0) {
      await tx
        .update(purchaseRequestItems)
        .set({ status: "rejected", updatedAt: now })
        .where(and(
          inArray(purchaseRequestItems.id, itemIdsToReject),
          inArray(purchaseRequestItems.status, REJECTABLE_ITEM_STATUSES),
        ))

      for (const item of items.filter((i) => itemIdsToReject.includes(i.id))) {
        await recordStatusChange({
          entityType: "request_item",
          entityId:   item.id,
          fromStatus: item.status,
          toStatus:   "rejected",
          changedBy:  userId,
          reason,
        }, tx)
      }

      await resolveReplenishmentLinksTx(tx, itemIdsToReject)
    }

    await tx
      .update(purchaseRequests)
      .set({ status: "cancelled", closedAt: now, updatedAt: now })
      .where(and(eq(purchaseRequests.id, requestId), eq(purchaseRequests.status, request.status)))

    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   requestId,
      fromStatus: request.status,
      toStatus:   "cancelled",
      changedBy:  userId,
      reason,
    }, tx)

    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_request",
      entityId:   requestId,
      entityCode: request.code,
      oldState:   { status: request.status },
      newState:   { status: "cancelled", rejectedItemIds: itemIdsToReject },
      reason,
    }, tx)

    return { rejectedItemIds: itemIdsToReject }
  })
}
