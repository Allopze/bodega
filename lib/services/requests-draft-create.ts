import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { type Tx } from "@/db"
import {
  purchaseRequests,
  purchaseRequestItems,
  requestItemAttributes,
  productAttributes,
  products,
  workers,
} from "@/db/schema"
import { catalogItemIssues, type CatalogProductRules } from "@/lib/products/service-items"
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

/**
 * Reglas que el catálogo impone al ítem: colaborador obligatorio
 * (`requires_worker`) y atributos declarados —presencia y tipo, incluido el
 * conteo entero de `integer`—. El formulario ya las avisa, pero la fuente de
 * verdad es esta: el payload llega como JSON y `isRequired`/`type` se releen
 * del catálogo, nunca de lo que mandó el cliente.
 */
async function assertCatalogItemRules(tx: Tx, items: RequestItemFormData[]): Promise<void> {
  const productIds = [...new Set(items.flatMap((item) => (item.productId ? [item.productId] : [])))]
  if (productIds.length === 0) return

  const [productRows, attributeRows] = await Promise.all([
    tx.select({ id: products.id, name: products.name, requiresWorker: products.requiresWorker })
      .from(products)
      .where(inArray(products.id, productIds)),
    tx.select({
      id:         productAttributes.id,
      productId:  productAttributes.productId,
      name:       productAttributes.name,
      type:       productAttributes.type,
      isRequired: productAttributes.isRequired,
    })
      .from(productAttributes)
      .where(inArray(productAttributes.productId, productIds)),
  ])

  const rulesByProductId = new Map<string, CatalogProductRules>(
    productRows.map((product) => [product.id, {
      name:           product.name,
      requiresWorker: product.requiresWorker,
      attributes:     attributeRows
        .filter((attribute) => attribute.productId === product.id)
        .map((attribute) => ({
          id: attribute.id, name: attribute.name, type: attribute.type, isRequired: attribute.isRequired,
        })),
    }]),
  )

  for (const [index, item] of items.entries()) {
    if (!item.productId) continue
    const rules = rulesByProductId.get(item.productId)
    if (!rules) continue
    const issues = catalogItemIssues(rules, item)
    if (issues.length > 0) throw new Error(`Ítem ${index + 1}: ${issues.join("; ")}`)
  }
}

async function insertAllItems(
  tx: Tx,
  requestId: string,
  requiredDate: string,
  items: RequestItemFormData[],
  opts: { sessionUserId: string; worksiteId: string },
): Promise<string[]> {
  await assertCatalogItemRules(tx, items)

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
