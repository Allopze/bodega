import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import {
  approvalDecisions,
  deliveryItems,
  eppProductFamilies,
  eppReplenishmentLinks,
  products,
  purchaseOrderItems,
  purchaseRequestItems,
  purchaseRequests,
  requestItemAttributes,
  workers,
} from "@/db/schema"
import type { RequestItemFormData } from "@/lib/validation/operations"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { resolveCatalogItemQuantitiesTx } from "./requests-draft-create"

const EDITABLE_REQUEST_STATUSES = ["submitted", "in_review", "partially_approved"]

/**
 * Updates one undecided line without rewriting sibling items or approval history.
 * The item lock is deliberately acquired before the request lock, matching the
 * approval and cancellation services so an edit cannot race a decision.
 */
export async function updatePendingRequestItem(input: {
  itemId: string
  expectedUpdatedAt: string
  actorUserId: string
  actorUserEmail?: string
  item: RequestItemFormData
}): Promise<{ updatedAt: string; quantity: number }> {
  return await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, input.itemId))
      .for("update")
    if (!item) throw new Error("Ítem no encontrado")

    const [request] = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, item.requestId))
      .for("update")
    if (!request) throw new Error("Solicitud no encontrada")
    if (request.requesterId !== input.actorUserId) {
      throw new Error("Solo quien creó la solicitud puede editar sus ítems")
    }
    if (!["epp", "otro"].includes(request.requestType)) {
      throw new Error("La edición por ítem solo está disponible para solicitudes EPP y Otros")
    }
    if (!EDITABLE_REQUEST_STATUSES.includes(request.status)) {
      throw new Error("La solicitud ya no está en etapa de aprobación")
    }
    if (item.status !== "requested") {
      throw new Error("Este ítem ya fue aprobado, rechazado o pasó a otra etapa")
    }
    if (item.updatedAt !== input.expectedUpdatedAt) {
      throw new Error("El ítem cambió desde que abriste la edición. Actualiza la página e inténtalo nuevamente")
    }

    const [decision] = await tx
      .select({ id: approvalDecisions.id })
      .from(approvalDecisions)
      .where(eq(approvalDecisions.requestItemId, item.id))
      .limit(1)
    if (decision) throw new Error("Este ítem ya tiene una decisión de aprobación registrada")

    const [orderLine] = await tx
      .select({ id: purchaseOrderItems.id })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.requestItemId, item.id))
      .limit(1)
    const [deliveryLine] = await tx
      .select({ id: deliveryItems.id })
      .from(deliveryItems)
      .where(eq(deliveryItems.requestItemId, item.id))
      .limit(1)
    if (orderLine || deliveryLine) {
      throw new Error("Este ítem ya está vinculado a una compra o entrega y no se puede editar")
    }

    const nextItem = {
      ...input.item,
      id: item.id,
      productId: input.item.productId || null,
      workerId: input.item.workerId === undefined ? item.workerId : input.item.workerId || null,
      productNameFree: input.item.productId ? null : input.item.productNameFree?.trim() || null,
      attributes: input.item.attributes ?? [],
    }

    if (nextItem.productId !== item.productId) {
      if (nextItem.productId) {
        const [product] = await tx
          .select({ isActive: products.isActive })
          .from(products)
          .where(eq(products.id, nextItem.productId))
          .limit(1)
        if (!product?.isActive) throw new Error("Selecciona un producto activo del catálogo")
      }
      if (item.equipmentId || item.emergencyResourceId) {
        throw new Error("No se puede cambiar el producto de un ítem vinculado a un equipo o activo")
      }
    }

    if (nextItem.workerId && nextItem.workerId !== item.workerId) {
      const [worker] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(and(
          eq(workers.id, nextItem.workerId),
          eq(workers.worksiteId, request.worksiteId),
          eq(workers.isActive, true),
        ))
        .limit(1)
      if (!worker) throw new Error("El colaborador debe estar activo y pertenecer a la faena de la solicitud")
    }

    const [replenishmentLink] = await tx
      .select({ eppTypeId: eppReplenishmentLinks.eppTypeId })
      .from(eppReplenishmentLinks)
      .where(and(
        eq(eppReplenishmentLinks.requestItemId, item.id),
        isNull(eppReplenishmentLinks.resolvedAt),
      ))
      .limit(1)
    if (replenishmentLink) {
      if (nextItem.workerId !== item.workerId || nextItem.quantity !== item.quantity) {
        throw new Error("Este ítem repone una brecha de EPP; conserva colaborador y cantidad")
      }
      if (nextItem.productId !== item.productId) {
        const productIds = [item.productId, nextItem.productId].filter((id): id is string => id !== null)
        const linkedProducts = await tx
          .select({ id: products.id, familyId: products.familyId })
          .from(products)
          .where(inArray(products.id, productIds))
        const familyIds = linkedProducts.flatMap((product) => product.familyId ? [product.familyId] : [])
        const families = familyIds.length === 0
          ? []
          : await tx
              .select({ id: eppProductFamilies.id, eppTypeId: eppProductFamilies.eppTypeId })
              .from(eppProductFamilies)
              .where(inArray(eppProductFamilies.id, familyIds))
        const typeByFamilyId = new Map(families.map((family) => [family.id, family.eppTypeId]))
        const sameEppType = linkedProducts.length === 2
          && linkedProducts.every((product) => product.familyId
            && typeByFamilyId.get(product.familyId) === replenishmentLink.eppTypeId)
        if (!sameEppType) {
          throw new Error("El producto debe pertenecer al mismo tipo de EPP que originó la reposición")
        }
      }
    }

    const duplicateAttributeNames = new Set<string>()
    for (const attribute of nextItem.attributes) {
      const key = attribute.attributeName.toLocaleLowerCase("es-CL")
      if (duplicateAttributeNames.has(key)) throw new Error("El ítem contiene atributos duplicados")
      duplicateAttributeNames.add(key)
    }

    const oldAttributes = await tx
      .select({ attributeId: requestItemAttributes.attributeId, attributeName: requestItemAttributes.attributeName, value: requestItemAttributes.value })
      .from(requestItemAttributes)
      .where(eq(requestItemAttributes.requestItemId, item.id))
    const comparableAttributes = (attributes: Array<{ attributeId?: string | null; attributeName: string; value: string }>) =>
      attributes
        .map(({ attributeId, attributeName, value }) => ({ attributeId: attributeId ?? null, attributeName, value }))
        .sort((left, right) => left.attributeName.localeCompare(right.attributeName, "es-CL"))
    const catalogRelevantChange = nextItem.productId !== item.productId
      || nextItem.productNameFree !== item.productNameFree
      || nextItem.quantity !== item.quantity
      || nextItem.unitOfMeasure !== item.unitOfMeasure
      || nextItem.workerId !== item.workerId
      || JSON.stringify(comparableAttributes(nextItem.attributes)) !== JSON.stringify(comparableAttributes(oldAttributes))
    const resolvedQuantities = catalogRelevantChange
      ? await resolveCatalogItemQuantitiesTx(tx, [nextItem])
      : new Map<number, number>()
    const quantity = resolvedQuantities.get(0) ?? nextItem.quantity

    const now = new Date().toISOString()
    const [updated] = await tx
      .update(purchaseRequestItems)
      .set({
        productId: nextItem.productId ?? null,
        productNameFree: nextItem.productNameFree,
        quantity,
        unitOfMeasure: nextItem.unitOfMeasure,
        urgency: nextItem.urgency,
        workerId: nextItem.workerId ?? null,
        suggestedSupplierId: nextItem.suggestedSupplierId || null,
        supplierHint: nextItem.supplierHint || null,
        notes: nextItem.notes || null,
        updatedAt: now,
      })
      .where(and(
        eq(purchaseRequestItems.id, item.id),
        eq(purchaseRequestItems.status, "requested"),
        eq(purchaseRequestItems.updatedAt, input.expectedUpdatedAt),
      ))
      .returning({ updatedAt: purchaseRequestItems.updatedAt })
    if (!updated) throw new Error("El ítem cambió mientras lo editabas. Actualiza la página e inténtalo nuevamente")

    await tx.delete(requestItemAttributes).where(eq(requestItemAttributes.requestItemId, item.id))
    if (nextItem.attributes.length > 0) {
      await tx.insert(requestItemAttributes).values(nextItem.attributes.map((attribute) => ({
        id: nanoid(),
        requestItemId: item.id,
        attributeId: attribute.attributeId || null,
        attributeName: attribute.attributeName,
        value: attribute.value,
      })))
    }

    await tx.update(purchaseRequests)
      .set({ updatedAt: now })
      .where(eq(purchaseRequests.id, request.id))

    await recordAudit({
      userId: input.actorUserId,
      userEmail: input.actorUserEmail,
      action: "update",
      entityType: "request_item",
      entityId: item.id,
      entityCode: request.code,
      worksiteId: request.worksiteId,
      oldState: {
        productId: item.productId,
        productNameFree: item.productNameFree,
        quantity: item.quantity,
        unitOfMeasure: item.unitOfMeasure,
        urgency: item.urgency,
        workerId: item.workerId,
        suggestedSupplierId: item.suggestedSupplierId,
        supplierHint: item.supplierHint,
        notes: item.notes,
        attributes: oldAttributes,
      },
      newState: {
        productId: nextItem.productId ?? null,
        productNameFree: nextItem.productNameFree,
        quantity,
        unitOfMeasure: nextItem.unitOfMeasure,
        urgency: nextItem.urgency,
        workerId: nextItem.workerId ?? null,
        suggestedSupplierId: nextItem.suggestedSupplierId || null,
        supplierHint: nextItem.supplierHint || null,
        notes: nextItem.notes || null,
        attributes: nextItem.attributes,
        status: "requested",
      },
    }, tx)

    return { updatedAt: updated.updatedAt, quantity }
  })
}
