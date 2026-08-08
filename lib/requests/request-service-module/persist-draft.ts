import { eq } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequests,
  purchaseRequestItems,
  requestItemAttributes,
  approvalDecisions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import type { RequestModuleConfig, RequestServiceInput } from "../request-config"
import type { Session } from "next-auth"

export async function persistDraft(
  config: Pick<RequestModuleConfig, "requestType" | "codePrefix" | "attributeNames">,
  session: Session,
  data: RequestServiceInput,
): Promise<string> {
  const isEdit = !!data.id
  const requestId = data.id ?? nanoid()
  const now = new Date().toISOString()
  const year = new Date().getFullYear()

  await db.transaction(async (tx) => {
    if (isEdit) {
      // DAT-3: lockeado — sin esto, un submitRequest concurrente puede mover
      // la solicitud a 'submitted' con ítems 'requested' justo entre esta
      // lectura y el DELETE de más abajo, que igual borraría esos ítems ya
      // enviados y crearía 'draft' nuevos bajo una solicitud que ya no lo es.
      const [existing] = await tx
        .select({ id: purchaseRequests.id, requesterId: purchaseRequests.requesterId, status: purchaseRequests.status })
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, requestId))
        .for("update")
      if (!existing) throw new Error("Solicitud no encontrada")
      if (existing.status !== "draft") {
        throw new Error("Solo se puede editar una solicitud en borrador")
      }
      if (existing.requesterId !== session.user.id) {
        throw new Error("Solo el solicitante puede editar su propia solicitud")
      }

      await tx.update(purchaseRequests).set({
        worksiteId:   data.worksiteId,
        urgency:      data.urgency,
        requiredDate: data.requiredDate,
        notes:        data.justification || null,
        updatedAt:    now,
      }).where(eq(purchaseRequests.id, requestId))

      await tx.delete(approvalDecisions).where(
        eq(approvalDecisions.requestId, requestId),
      )

      await tx.delete(purchaseRequestItems).where(eq(purchaseRequestItems.requestId, requestId))
    } else {
      const code = await nextCodeTx(tx, config.codePrefix, year)
      await tx.insert(purchaseRequests).values({
        id:          requestId,
        code,
        worksiteId:  data.worksiteId,
        requesterId: session.user.id,
        requestType: config.requestType,
        urgency:     data.urgency,
        requiredDate: data.requiredDate,
        notes:       data.justification || null,
        status:      "draft",
        createdAt:   now,
        updatedAt:   now,
      })

      await recordAudit({
        userId:     session.user.id,
        userEmail:  session.user.email ?? undefined,
        action:     "create",
        entityType: "purchase_request",
        entityId:   requestId,
        entityCode: code,
        newState:   { status: "draft", requestType: config.requestType },
      }, tx)
    }

    for (const [i, item] of data.items.entries()) {
      const itemId = item.id ?? nanoid()

      await tx.insert(purchaseRequestItems).values({
        id:              itemId,
        requestId,
        productId:       null,
        productNameFree: item.description,
        quantity:        item.quantity,
        unitOfMeasure:   item.unitOfMeasure,
        status:          "draft",
        urgency:         data.urgency,
        requiredDate:    data.requiredDate,
        workerId:        null,
        sortOrder:       item.sortOrder ?? i,
        notes:           item.notes ?? null,
        createdAt:       now,
        updatedAt:       now,
      })

      for (const [fieldName, displayName] of Object.entries(config.attributeNames)) {
        const value = item[fieldName as keyof RequestServiceInput["items"][number]]
        if (typeof value === "string" && value.trim()) {
          await tx.insert(requestItemAttributes).values({
            id:            nanoid(),
            requestItemId: itemId,
            attributeId:   null,
            attributeName: displayName,
            value:         value.trim(),
          })
        }
      }
    }
  })

  return requestId
}
