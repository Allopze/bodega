/**
 * lib/services/requests-draft.ts
 *
 * Diff-based persist logic for purchase requests.
 *
 * Security audit A-01 / A-08: the previous implementation deleted and
 * re-inserted every request item on each save, which:
 *   - wiped `approval_decisions` rows (legal audit trail lost when an
 *     approver had modified the quantity),
 *   - wiped `inventory_movements` references,
 *   - generated expensive cascade deletes on `request_item_attributes`,
 *   - created a window where approvers could see "no items" between the
 *     delete and the re-insert.
 *
 * This service performs a true diff: items with a stable `id` are
 * updated in place (preserving `approval_decisions` and references),
 * items without an `id` are inserted, and items present in the DB but
 * missing from the input are deleted (and only their `approval_decisions`
 * are removed with them).
 */

import { eq, inArray } from "drizzle-orm"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { db, type Tx } from "@/db"
import {
  approvalDecisions,
  purchaseRequestItems,
  purchaseRequests,
  requestItemAttributes,
} from "@/db/schema"
import type {
  RequestFormData,
  RequestItemFormData,
} from "@/lib/validation/operations"

export interface PersistDraftResult {
  requestId: string
  isNew: boolean
}

/**
 * Persist a request (create or update) using a diff algorithm.
 *
 * Caller must have validated input with `requestSchema` and verified
 * worksite access. This function is wrapped in its own transaction
 * by the caller (or by `persistRequestWithDiff` below).
 */
export async function persistRequestWithDiff(
  sessionUserId: string,
  sessionUserEmail: string | undefined,
  data: RequestFormData,
  isEdit: boolean,
  actorCanEditAnyRequest: boolean,
): Promise<PersistDraftResult> {
  if (isEdit && !data.id) {
    throw new Error("Internal: isEdit=true but data.id is missing")
  }
  return await db.transaction(async (tx) => {
    if (isEdit) {
      return await updateRequestWithDiff(tx, data, sessionUserId, sessionUserEmail, actorCanEditAnyRequest)
    }
    return await createRequestWithDiff(tx, data, sessionUserId, sessionUserEmail)
  })
}

// ── Create path ─────────────────────────────────────────────────────────────

async function createRequestWithDiff(
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

// ── Update path (diff) ──────────────────────────────────────────────────────

async function updateRequestWithDiff(
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

  // Update header in place. Note we do NOT touch the code or the
  // requester: changing those would break audit trails and ownership
  // checks throughout the system.
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
    .select({
      id: purchaseRequestItems.id,
    })
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

  // A-08: only delete `approval_decisions` for items that are actually
  // being removed. Updates preserve the audit trail.
  if (toDelete.length > 0) {
    await tx
      .delete(approvalDecisions)
      .where(inArray(approvalDecisions.requestItemId, toDelete))

    // Replace attributes for the deleted items so we don't leave
    // dangling rows. request_item_attributes has ON DELETE CASCADE on
    // request_item_id, so deleting the parent item is enough — but
    // approval_decisions does NOT cascade. That's why we delete them
    // explicitly above.
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
        // status is intentionally NOT updated here. Edits in draft/
        // returned state never regress an item's status; transitions
        // happen via the state machine.
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
      workerId:            null,
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

  void sessionUserEmail // reserved for future audit extension

  return { requestId, isNew: false }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function replaceAttributes(
  tx: Tx,
  requestItemId: string,
  attributes: { id?: string; attributeId?: string | null; attributeName: string; value: string }[],
): Promise<void> {
  // The schema doesn't have a unique index on (request_item_id, ...),
  // so the safest diff is to delete-and-reinsert within the same
  // transaction. Attributes don't carry audit trail, so this is OK.
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
