import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { type Tx } from "@/db"
import {
  purchaseRequests,
  purchaseRequestItems,
  requestItemAttributes,
} from "@/db/schema"
import type { RequestFormData, RequestItemFormData } from "@/lib/validation/operations"
import type { PersistDraftResult } from "./requests-draft.types"

export async function createRequestWithDiff(
  tx: Tx,
  data: RequestFormData,
  sessionUserId: string,
  sessionUserEmail: string | undefined,
): Promise<PersistDraftResult> {
  const code = await nextCodeTx(tx, "SOL")
  const requestId = nanoid()

  await tx.insert(purchaseRequests).values({
    id:           requestId,
    code,
    worksiteId:   data.worksiteId,
    requesterId:  sessionUserId,
    requestType:  data.requestType,
    urgency:      data.urgency,
    requiredDate: data.requiredDate,
    status:       "draft",
    notes:        data.notes || null,
  })

  await recordAudit({
    userId:     sessionUserId,
    userEmail:  sessionUserEmail,
    action:     "create",
    entityType: "purchase_request",
    entityId:   requestId,
    entityCode: code,
    newState:   { status: "draft", worksiteId: data.worksiteId },
  }, tx)

  await insertAllItems(tx, requestId, data.requiredDate, data.items)

  return { requestId, isNew: true }
}

async function insertAllItems(
  tx: Tx,
  requestId: string,
  requiredDate: string,
  items: RequestItemFormData[],
): Promise<void> {
  for (const [i, item] of items.entries()) {
    const itemId = item.id ?? nanoid()
    await tx.insert(purchaseRequestItems).values({
      id:                  itemId,
      requestId,
      productId:           item.productId || null,
      productNameFree:     item.productNameFree?.trim() || null,
      quantity:            item.quantity,
      unitOfMeasure:       item.unitOfMeasure,
      status:              "draft",
      urgency:             item.urgency,
      requiredDate,
      workerId:            null,
      suggestedSupplierId: item.suggestedSupplierId || null,
      supplierHint:        item.supplierHint || null,
      sortOrder:           item.sortOrder ?? i,
      notes:               item.notes || null,
    })

    if (item.attributes.length > 0) {
      await tx.insert(requestItemAttributes).values(
        item.attributes.map((a) => ({
          id:            nanoid(),
          requestItemId: itemId,
          attributeId:   a.attributeId || null,
          attributeName: a.attributeName,
          value:         a.value,
        })),
      )
    }
  }
}
