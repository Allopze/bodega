import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { type Tx } from "@/db"
import {
  purchaseRequests,
  purchaseRequestItems,
  requestItemAttributes,
  workers,
} from "@/db/schema"
import type { RequestFormData, RequestItemFormData } from "@/lib/validation/operations"

/**
 * Crea una solicitud EPP/otro ya enviada a aprobación (2026-08-07: el único
 * camino para esos tipos — nacen enviadas, nunca en borrador). Los tipos con
 * cotización (repuestos/servicios) siguen naciendo en borrador y enviándose
 * aparte, por lib/requests/request-service-module/persist-draft.ts.
 *
 * ARQ-2: hasta 2026-08 esta función soportaba también crear en borrador
 * (`CreateRequestOptions.submitted`) y devolvía `isNew` para un persist por
 * diff que la simplificación del flujo dejó sin uso — su único caller
 * siempre pasaba `submitted: true`.
 */
export async function createRequest(
  tx: Tx,
  data: RequestFormData,
  sessionUserId: string,
  sessionUserEmail: string | undefined,
): Promise<{ requestId: string; code: string; itemIds: string[] }> {
  const code = await nextCodeTx(tx, "SOL")
  const requestId = nanoid()
  const now = new Date().toISOString()

  await tx.insert(purchaseRequests).values({
    id:           requestId,
    code,
    worksiteId:   data.worksiteId,
    requesterId:  sessionUserId,
    requestType:  data.requestType,
    urgency:      data.urgency,
    requiredDate: data.requiredDate,
    status:       "submitted",
    submittedAt:  now,
    notes:        data.notes || null,
    deliveryMode: data.deliveryMode ?? "via_oficina",
  })

  await recordAudit({
    userId:     sessionUserId,
    userEmail:  sessionUserEmail,
    action:     "create",
    entityType: "purchase_request",
    entityId:   requestId,
    entityCode: code,
    newState:   { status: "submitted", worksiteId: data.worksiteId },
  }, tx)

  await recordStatusChange({
    entityType: "purchase_request",
    entityId:   requestId,
    fromStatus: null,
    toStatus:   "submitted",
    changedBy:  sessionUserId,
  }, tx)

  const itemIds = await insertAllItems(tx, requestId, data.requiredDate, data.items, {
    sessionUserId,
    worksiteId: data.worksiteId,
  })

  return { requestId, code, itemIds }
}

async function insertAllItems(
  tx: Tx,
  requestId: string,
  requiredDate: string,
  items: RequestItemFormData[],
  opts: { sessionUserId: string; worksiteId: string },
): Promise<string[]> {
  // SEC-1: workerId no se valida contra la faena de la solicitud en ningún
  // otro punto de la creación — sin esto, un solicitante puede colocar el id
  // de un trabajador de otra faena en itemsJson. La entrega ya bloquea el
  // cruce (deliveries-worker-epp.ts), pero es mejor rechazarlo desde el
  // origen que confiar solo en el último paso.
  const workerIds = [...new Set(items.map((i) => i.workerId).filter((id): id is string => !!id))]
  if (workerIds.length > 0) {
    const workersInWorksite = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(and(inArray(workers.id, workerIds), eq(workers.worksiteId, opts.worksiteId)))
    const validWorkerIds = new Set(workersInWorksite.map((w) => w.id))
    const invalidId = workerIds.find((id) => !validWorkerIds.has(id))
    if (invalidId) throw new Error("El trabajador no pertenece a la faena de la solicitud")
  }

  const itemIds: string[] = []
  for (const [i, item] of items.entries()) {
    const itemId = item.id ?? nanoid()
    itemIds.push(itemId)
    await tx.insert(purchaseRequestItems).values({
      id:                  itemId,
      requestId,
      productId:           item.productId || null,
      productNameFree:     item.productNameFree?.trim() || null,
      quantity:            item.quantity,
      unitOfMeasure:       item.unitOfMeasure,
      status:              "requested",
      urgency:             item.urgency,
      requiredDate,
      workerId:            item.workerId || null,
      suggestedSupplierId: item.suggestedSupplierId || null,
      supplierHint:        item.supplierHint || null,
      sortOrder:           item.sortOrder ?? i,
      notes:               item.notes || null,
    })

    await recordStatusChange({
      entityType: "request_item",
      entityId:   itemId,
      fromStatus: null,
      toStatus:   "requested",
      changedBy:  opts.sessionUserId,
    }, tx)

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
  return itemIds
}
