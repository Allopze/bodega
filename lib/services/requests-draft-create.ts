import { and, asc, eq, inArray } from "drizzle-orm"
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
  preventionEmergencyResources,
  serviceEquipment,
  workers,
} from "@/db/schema"
import {
  catalogItemIssues, equipmentKindLabel, normalizeEquipmentCode, quantityFromAttributes,
  type CatalogProductRules,
} from "@/lib/products/service-items"
import type { RequestFormData, RequestItemFormData } from "@/lib/validation/operations"
import { openEmergencyResourceServiceCaseTx } from "@/lib/services/emergency-resource-service"

export interface RequestSubmissionIdentity {
  submissionKey: string
  submissionPayloadHash: string
}

/** A submission key must never be reused with a different validated payload. */
export class RequestSubmissionKeyConflictError extends Error {
  override name = "RequestSubmissionKeyConflictError"

  constructor() {
    super("La clave de envío ya está asociada a otra solicitud. Actualiza el formulario e inténtalo nuevamente.")
  }
}

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
  submission?: RequestSubmissionIdentity,
  resolvedCatalogQuantities?: ReadonlyMap<number, number>,
): Promise<{ requestId: string; code: string; itemIds: string[]; replayed: boolean }> {
  const code = await nextCodeTx(tx, "SOL")
  const requestId = nanoid()
  const now = new Date().toISOString()

  const values = {
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
    submissionKey: submission?.submissionKey ?? null,
    submissionPayloadHash: submission?.submissionPayloadHash ?? null,
  }

  if (submission) {
    const [inserted] = await tx.insert(purchaseRequests).values(values)
      .onConflictDoNothing({ target: [purchaseRequests.requesterId, purchaseRequests.submissionKey] })
      .returning({ id: purchaseRequests.id, code: purchaseRequests.code })
    if (!inserted) {
      // `ON CONFLICT DO NOTHING` waits for a concurrent insert to commit, and a
      // following read in this transaction sees it under PostgreSQL's default
      // READ COMMITTED isolation. Only the matching payload is an idempotent
      // replay; a different payload is a safe failure, never a second request.
      const [existing] = await tx
        .select({
          id: purchaseRequests.id,
          code: purchaseRequests.code,
          submissionPayloadHash: purchaseRequests.submissionPayloadHash,
        })
        .from(purchaseRequests)
        .where(and(
          eq(purchaseRequests.requesterId, sessionUserId),
          eq(purchaseRequests.submissionKey, submission.submissionKey),
        ))
        .for("update")
        .limit(1)
      if (!existing || existing.submissionPayloadHash !== submission.submissionPayloadHash) {
        throw new RequestSubmissionKeyConflictError()
      }
      return { requestId: existing.id, code: existing.code, itemIds: [], replayed: true }
    }
  } else {
    await tx.insert(purchaseRequests).values(values)
  }

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

  const itemIds = await insertAllItems(
    tx,
    requestId,
    data.requiredDate,
    data.items,
    {
      sessionUserId,
      sessionUserEmail,
      worksiteId:  data.worksiteId,
      requestCode: code,
    },
    resolvedCatalogQuantities,
  )

  return { requestId, code, itemIds, replayed: false }
}

/**
 * Reglas que el catálogo impone al ítem: colaborador obligatorio
 * (`requires_worker`) y atributos declarados —presencia y tipo, incluido el
 * conteo entero de `integer`—. El formulario ya las avisa, pero la fuente de
 * verdad es esta: el payload llega como JSON y `isRequired`/`type` se releen
 * del catálogo, nunca de lo que mandó el cliente.
 */
export async function resolveCatalogItemQuantitiesTx(
  tx: Tx,
  items: RequestItemFormData[],
): Promise<Map<number, number>> {
  const drivenQuantities = new Map<number, number>()
  const productIds = [...new Set(items.flatMap((item) => (item.productId ? [item.productId] : [])))].sort()
  if (productIds.length === 0) return drivenQuantities

  // The direct-request preflight first locks the worksite, then reaches these
  // rows in product order. Holding shared locks through creation guarantees a
  // quantity-driving attribute cannot change between the stock snapshot and
  // the persisted request item.
  const productRows = await tx.select({
    id: products.id, name: products.name,
    requiresWorker: products.requiresWorker, equipmentKind: products.equipmentKind,
    serviceSubjectKind: products.serviceSubjectKind,
  })
    .from(products)
    .where(inArray(products.id, productIds))
    .orderBy(asc(products.id))
    .for("share")
  const attributeRows = await tx.select({
    id:         productAttributes.id,
    productId:  productAttributes.productId,
    name:       productAttributes.name,
    type:       productAttributes.type,
    options:    productAttributes.options,
    isRequired: productAttributes.isRequired,
    drivesQuantity: productAttributes.drivesQuantity,
  })
    .from(productAttributes)
    .where(inArray(productAttributes.productId, productIds))
    .orderBy(asc(productAttributes.productId), asc(productAttributes.id))
    .for("share")

  const rulesByProductId = new Map<string, CatalogProductRules>(
    productRows.map((product) => [product.id, {
      name:           product.name,
      requiresWorker: product.requiresWorker,
      equipmentKind:  product.equipmentKind,
      attributes:     attributeRows
        .filter((attribute) => attribute.productId === product.id)
        .map((attribute) => ({
          id: attribute.id, name: attribute.name, type: attribute.type, options: attribute.options,
          isRequired: attribute.isRequired, drivesQuantity: attribute.drivesQuantity,
        })),
    }]),
  )

  for (const [index, item] of items.entries()) {
    if (!item.productId) continue
    const rules = rulesByProductId.get(item.productId)
    if (!rules) continue
    const issues = catalogItemIssues(rules, item)
    if (issues.length > 0) throw new Error(`Ítem ${index + 1}: ${issues.join("; ")}`)

    const quantityDriver = rules.attributes.find((attribute) => attribute.drivesQuantity)
    if (quantityDriver && (quantityDriver.type !== "integer" || !quantityDriver.isRequired)) {
      // Defend against legacy/corrupt catalog rows too. A quantity driver must
      // never silently fall back to a client-controlled item quantity.
      throw new Error(`Ítem ${index + 1}: el atributo que gobierna la cantidad debe ser entero y obligatorio`)
    }

    // Cuando el catálogo gobierna la cantidad (nº de dosis), se deriva del
    // atributo en vez de creerle al cliente: así no hay dos números que puedan
    // contradecirse ni forma de pedir 1 unidad de una vacuna de 3 dosis.
    const driven = quantityFromAttributes(rules, item)
    if (quantityDriver) {
      if (driven === null) {
        throw new Error(`Ítem ${index + 1}: ${quantityDriver.name} debe ser un número entero mayor o igual a 1`)
      }
      drivenQuantities.set(index, driven)
    }
  }

  return drivenQuantities
}

/**
 * Resuelve el equipo de cada ítem de servicio a partir del **código** que
 * escribió quien solicita, dando de alta la ficha si el registro no la tenía.
 *
 * El registro de instrumentos no se llena por adelantado: nadie lo hizo y sin
 * ficha no se podía pedir la mantención. Ahora el catálogo se forma con estas
 * solicitudes —la ficha nueva queda marcada `needs_review` para que
 * Administración le ponga nombre real, marca y serie— y un código ya conocido
 * reutiliza su ficha, que es lo que conserva el historial del aparato.
 *
 * La familia se relee del producto, nunca del cliente. Un equipo dado de baja
 * se reactiva y uno registrado en otra faena se reasigna a la de la solicitud:
 * si lo mandan a mantener, está en uso y está ahí.
 */
async function resolveEquipmentIds(
  tx: Tx,
  items: RequestItemFormData[],
  opts: { worksiteId: string; sessionUserId: string; sessionUserEmail?: string; requestCode: string },
): Promise<Map<number, string>> {
  const resolved = new Map<number, string>()
  const productIds = [...new Set(items.flatMap((i) => (i.productId ? [i.productId] : [])))]
  if (productIds.length === 0) return resolved

  const kindByProductId = new Map(
    (await tx.select({ id: products.id, equipmentKind: products.equipmentKind })
      .from(products)
      .where(inArray(products.id, productIds))
    ).map((product) => [product.id, product.equipmentKind] as const),
  )

  const findByCode = async (code: string) => {
    const [row] = await tx
      .select({
        id: serviceEquipment.id, kind: serviceEquipment.kind,
        worksiteId: serviceEquipment.worksiteId, isActive: serviceEquipment.isActive,
      })
      .from(serviceEquipment)
      .where(eq(serviceEquipment.code, code))
      .limit(1)
    return row
  }

  // Dos ítems con el mismo código son el mismo aparato: se resuelve una vez.
  const idByCode = new Map<string, string>()

  for (const [index, item] of items.entries()) {
    const kind = item.productId ? kindByProductId.get(item.productId) : null
    if (!kind) continue

    const code = normalizeEquipmentCode(item.equipmentCode ?? "")
    if (!code) throw new Error(`Ítem ${index + 1}: indica el código del equipo`)

    const cached = idByCode.get(code)
    if (cached) { resolved.set(index, cached); continue }

    let equipment = await findByCode(code)

    if (!equipment) {
      const id = nanoid()
      const inserted = await tx.insert(serviceEquipment).values({
        id,
        code,
        name:        `${equipmentKindLabel(kind)} ${code}`,
        kind,
        worksiteId:  opts.worksiteId,
        needsReview: true,
        notes:       `Alta automática desde la solicitud ${opts.requestCode}`,
      })
        // Otra solicitud pudo dar de alta el mismo código un instante antes: el
        // índice único manda y esta se cuelga de la ficha que quedó.
        .onConflictDoNothing({ target: serviceEquipment.code })
        .returning({ id: serviceEquipment.id })

      if (inserted.length > 0) {
        await recordAudit({
          userId:     opts.sessionUserId,
          userEmail:  opts.sessionUserEmail,
          action:     "create",
          entityType: "service_equipment",
          entityId:   id,
          entityCode: code,
          newState:   { code, kind, worksiteId: opts.worksiteId, needsReview: true, fromRequest: opts.requestCode },
        }, tx)

        idByCode.set(code, id)
        resolved.set(index, id)
        continue
      }
      equipment = await findByCode(code)
    }

    if (!equipment) throw new Error(`Ítem ${index + 1}: no se pudo registrar el equipo ${code}`)

    // Mismo código para dos familias distintas es un error de tipeo, no un
    // equipo que cambió de naturaleza: reescribir su familia rompería el
    // historial del aparato que sí lleva ese código.
    if (equipment.kind !== kind) {
      throw new Error(
        `Ítem ${index + 1}: el equipo ${code} está registrado como ${equipmentKindLabel(equipment.kind)}`
        + ` y este servicio es de ${equipmentKindLabel(kind)}`,
      )
    }

    const movedWorksite = equipment.worksiteId !== opts.worksiteId
    const reactivated   = !equipment.isActive
    if (movedWorksite || reactivated) {
      await tx.update(serviceEquipment)
        .set({ worksiteId: opts.worksiteId, isActive: true, updatedAt: new Date().toISOString() })
        .where(eq(serviceEquipment.id, equipment.id))

      await recordAudit({
        userId:     opts.sessionUserId,
        userEmail:  opts.sessionUserEmail,
        action:     "update",
        entityType: "service_equipment",
        entityId:   equipment.id,
        entityCode: code,
        oldState:   { worksiteId: equipment.worksiteId, isActive: equipment.isActive },
        newState:   { worksiteId: opts.worksiteId, isActive: true, fromRequest: opts.requestCode },
      }, tx)
    }

    idByCode.set(code, equipment.id)
    resolved.set(index, equipment.id)
  }

  return resolved
}

async function insertAllItems(
  tx: Tx,
  requestId: string,
  requiredDate: string,
  items: RequestItemFormData[],
  opts: { sessionUserId: string; sessionUserEmail?: string; worksiteId: string; requestCode: string },
  resolvedCatalogQuantities?: ReadonlyMap<number, number>,
): Promise<string[]> {
  // A direct EPP submission resolves these rules while it holds the selected
  // worksite/catalog snapshot. Reusing that map makes the stock warning,
  // signed confirmation and persisted line agree even if a new attribute is
  // configured concurrently. Other callers retain the standalone validation.
  const drivenQuantities = resolvedCatalogQuantities ?? await resolveCatalogItemQuantitiesTx(tx, items)

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

  // El equipo llega como código, no como id: el registro se forma con estas
  // solicitudes. La familia y la faena las pone el servidor, nunca el cliente.
  const equipmentIdByIndex = await resolveEquipmentIds(tx, items, opts)

  const emergencyResourceIds = [...new Set(items.flatMap((item) => item.emergencyResourceId ? [item.emergencyResourceId] : []))]
  const emergencyResourcesInWorksite = emergencyResourceIds.length === 0 ? [] : await tx.select({
    id: preventionEmergencyResources.id,
  }).from(preventionEmergencyResources).where(and(
    inArray(preventionEmergencyResources.id, emergencyResourceIds),
    eq(preventionEmergencyResources.worksiteId, opts.worksiteId),
  ))
  const validEmergencyResourceIds = new Set(emergencyResourcesInWorksite.map((resource) => resource.id))

  const serviceProductIds = [...new Set(items.flatMap((item) => item.productId ? [item.productId] : []))]
  const serviceTargetByProductId = new Map(
    (serviceProductIds.length === 0 ? [] : await tx.select({ id: products.id, serviceSubjectKind: products.serviceSubjectKind })
      .from(products)
      .where(inArray(products.id, serviceProductIds))
    ).map((product) => [product.id, product.serviceSubjectKind] as const),
  )

  const itemIds: string[] = []
  for (const [i, item] of items.entries()) {
    const serviceTarget = item.productId ? serviceTargetByProductId.get(item.productId) : null
    if (serviceTarget === "emergency_resource" && !item.emergencyResourceId) {
      throw new Error(`Ítem ${i + 1}: selecciona el activo de emergencia`)
    }
    if (item.emergencyResourceId && serviceTarget !== "emergency_resource") {
      throw new Error(`Ítem ${i + 1}: el producto no corresponde a un servicio de activos de emergencia`)
    }
    if (item.emergencyResourceId && !validEmergencyResourceIds.has(item.emergencyResourceId)) {
      throw new Error(`Ítem ${i + 1}: el activo de emergencia no pertenece a la faena de la solicitud`)
    }
    const itemId = item.id ?? nanoid()
    itemIds.push(itemId)
    await tx.insert(purchaseRequestItems).values({
      id:                  itemId,
      requestId,
      productId:           item.productId || null,
      productNameFree:     item.productNameFree?.trim() || null,
      quantity:            drivenQuantities.get(i) ?? item.quantity,
      unitOfMeasure:       item.unitOfMeasure,
      status:              "requested",
      urgency:             item.urgency,
      requiredDate,
      workerId:            item.workerId || null,
      equipmentId:         equipmentIdByIndex.get(i) ?? null,
      emergencyResourceId: item.emergencyResourceId || null,
      suggestedSupplierId: item.suggestedSupplierId || null,
      supplierHint:        item.supplierHint || null,
      sortOrder:           item.sortOrder ?? i,
      notes:               item.notes || null,
    })

    if (item.emergencyResourceId) {
      await openEmergencyResourceServiceCaseTx(tx, {
        resourceId: item.emergencyResourceId,
        requestItemId: itemId,
        worksiteId: opts.worksiteId,
        actorUserId: opts.sessionUserId,
      })
    }

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
