import { eq, inArray } from "drizzle-orm"
import { nanoid } from "@/lib/id"
import { type Tx } from "@/db"
import {
  approvalDecisions,
  purchaseRequestItems,
  purchaseRequests,
  requestItemAttributes,
} from "@/db/schema"
import type { RequestFormData, RequestItemFormData } from "@/lib/validation/operations"
import type { PersistDraftResult } from "./requests-draft.types"

export async function updateRequestWithDiff(
  tx: Tx,
  data: RequestFormData,
  sessionUserId: string,
  sessionUserEmail: string | undefined,
  actorCanEditAnyRequest: boolean,
): Promise<PersistDraftResult> {
  const requestId = data.id!
  const existing = await tx.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
  })
  if (!existing) throw new Error("Solicitud no encontrada")
  if (!["draft", "returned"].includes(existing.status)) {
    throw new Error("Solo se pueden editar solicitudes en borrador o devueltas")
  }
  if (existing.requesterId !== sessionUserId && !actorCanEditAnyRequest) {
    throw new Error("Solo puedes editar tus propias solicitudes")
  }

  // Update header in place.
  await tx.update(purchaseRequests).set({
    worksiteId:   data.worksiteId,
    requestType:  data.requestType,
    urgency:      data.urgency,
    requiredDate: data.requiredDate,
    status:       "draft",
    notes:        data.notes || null,
    updatedAt:    new Date().toISOString(),
  }).where(eq(purchaseRequests.id, requestId))

  // Load current items to compute the diff.
  const currentItems = await tx
    .select({ id: purchaseRequestItems.id })
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.requestId, requestId))

  const currentIds = new Set(currentItems.map((row) => row.id))
  const submittedIds = new Set(
    data.items
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  )

  const toDelete   = [...currentIds].filter((id) => !submittedIds.has(id))
  const toInsert   = data.items.filter((item) => !item.id)
  const toUpdate   = data.items.filter(
    (item): item is RequestItemFormData & { id: string } =>
      typeof item.id === "string" && item.id.length > 0 && currentIds.has(item.id),
  )

  if (toDelete.length > 0) {
    await tx
      .delete(approvalDecisions)
      .where(inArray(approvalDecisions.requestItemId, toDelete))

    await tx
      .delete(purchaseRequestItems)
      .where(inArray(purchaseRequestItems.id, toDelete))
  }

  for (const item of toUpdate) {
    await tx
      .update(purchaseRequestItems)
      .set({
        productId:           item.productId || null,
        productNameFree:     item.productNameFree?.trim() || null,
        quantity:            item.quantity,
        unitOfMeasure:       item.unitOfMeasure,
        urgency:             item.urgency,
        requiredDate:        data.requiredDate,
        suggestedSupplierId: item.suggestedSupplierId || null,
        supplierHint:        item.supplierHint || null,
        sortOrder:           item.sortOrder,
        notes:               item.notes || null,
        updatedAt:           new Date().toISOString(),
      })
      .where(eq(purchaseRequestItems.id, item.id))

    await replaceAttributes(tx, item.id, item.attributes)
  }

  for (const item of toInsert) {
    const newId = nanoid()
    await tx.insert(purchaseRequestItems).values({
      id:                  newId,
      requestId,
      productId:           item.productId || null,
      productNameFree:     item.productNameFree?.trim() || null,
      quantity:            item.quantity,
      unitOfMeasure:       item.unitOfMeasure,
      status:              "draft",
      urgency:             item.urgency,
      requiredDate:        data.requiredDate,
      workerId:            item.workerId || null,
      suggestedSupplierId: item.suggestedSupplierId || null,
      supplierHint:        item.supplierHint || null,
      sortOrder:           item.sortOrder,
      notes:               item.notes || null,
    })

    if (item.attributes.length > 0) {
      await tx.insert(requestItemAttributes).values(
        item.attributes.map((a) => ({
          id:            nanoid(),
          requestItemId: newId,
          attributeId:   a.attributeId || null,
          attributeName: a.attributeName,
          value:         a.value,
        })),
      )
    }
  }

  void sessionUserEmail

  return { requestId, isNew: false }
}

async function replaceAttributes(
  tx: Tx,
  requestItemId: string,
  attributes: { id?: string; attributeId?: string | null; attributeName: string; value: string }[],
): Promise<void> {
  await tx
    .delete(requestItemAttributes)
    .where(eq(requestItemAttributes.requestItemId, requestItemId))

  if (attributes.length === 0) return

  await tx.insert(requestItemAttributes).values(
    attributes.map((a) => ({
      id:            nanoid(),
      requestItemId,
      attributeId:   a.attributeId || null,
      attributeName: a.attributeName,
      value:         a.value,
    })),
  )
}
