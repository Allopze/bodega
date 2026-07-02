import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import type { RequestModuleConfig } from "../request-config"

export async function cancelRequest(
  config: Pick<RequestModuleConfig, "requestType">,
  requestId: string,
  userId: string,
  reason: string,
  opts?: { userEmail?: string },
): Promise<void> {
  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    const request = await tx.query.purchaseRequests.findFirst({
      where: and(
        eq(purchaseRequests.id, requestId),
        eq(purchaseRequests.requestType, config.requestType),
      ),
    })
    if (!request) throw new Error("Solicitud no encontrada")
    if (!["draft", "submitted", "in_review", "returned"].includes(request.status)) {
      throw new Error(`No se puede cancelar una solicitud en estado '${request.status}'`)
    }

    await tx.update(purchaseRequests).set({
      status:    "cancelled",
      closedAt:  now,
      updatedAt: now,
    }).where(eq(purchaseRequests.id, requestId))

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
      newState:   { status: "cancelled" },
      reason,
    }, tx)
  })
}
