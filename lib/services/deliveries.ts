import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  attachments, deliveries, deliveryItems,
  products, purchaseRequestItems, purchaseRequests, workers, worksites, worksiteStock,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { deliverItemTx } from "@/lib/services/item-state"
import { applyMovementTx } from "@/lib/services/stock"

export interface RegisterWorksiteDeliveryInput {
  worksiteId: string
  productId: string
  requestItemId?: string | null
  quantity: number
  unitOfMeasure: string
  receiverName: string
  deliveredBy: string
  userEmail?: string
  notes?: string | null
}

export interface DeliveryAttachmentInput {
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
}

export interface RegisterWorkerEppDeliveryInput {
  worksiteId: string
  workerId: string
  requestItemId: string
  quantity: number
  deliveredBy: string
  userEmail?: string
  notes?: string | null
  proofAttachment?: DeliveryAttachmentInput | null
  // Return of old/discarded EPP (opcional)
  returnProductId?: string | null
  returnProductNameFree?: string | null
  returnQuantity?: number | null
  returnReason?: string | null
  returnNotes?: string | null
}

export async function registerWorksiteDelivery(
  input: RegisterWorksiteDeliveryInput,
  worksiteIds: string[] | 'all' = 'all',
): Promise<string> {
  if (!input.worksiteId) throw new Error("Selecciona una faena")
  if (worksiteIds !== 'all' && !worksiteIds.includes(input.worksiteId)) {
    throw new Error("No tienes acceso a esta faena")
  }
  if (!input.productId) throw new Error("Selecciona un producto")
  if (!input.receiverName.trim()) throw new Error("Indica quién recibió")
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("La cantidad debe ser mayor a 0")
  }

  const now = new Date().toISOString()
  const deliveryId = nanoid()
  const year = new Date().getFullYear()

  await db.transaction(async (tx) => {
    const code = await nextCodeTx(tx, "ENT", year)

    const worksite = await tx.query.worksites.findFirst({ where: eq(worksites.id, input.worksiteId) })
    const product = await tx.query.products.findFirst({ where: eq(products.id, input.productId) })

    if (!worksite || !worksite.isActive) throw new Error("Faena no disponible")
    if (!product || !product.isActive) throw new Error("Producto no disponible")

    let totalDelivered: number | undefined
    if (input.requestItemId) {
      // Lock the request item row to serialize concurrent deliveries on the same item.
      const [lockedRequestItem] = await tx
        .select()
        .from(purchaseRequestItems)
        .where(eq(purchaseRequestItems.id, input.requestItemId))
        .for("update")

      if (!lockedRequestItem) throw new Error("Ítem de solicitud no encontrado")
      if (!["received", "partially_delivered"].includes(lockedRequestItem.status)) {
        throw new Error("Solo puedes asociar ítems recibidos pendientes de entrega")
      }
      if (lockedRequestItem.productId !== input.productId) {
        throw new Error("El ítem trazable no coincide con el producto")
      }

      const previousDeliveries = await tx
        .select({ quantity: deliveryItems.quantity })
        .from(deliveryItems)
        .where(eq(deliveryItems.requestItemId, input.requestItemId))
      const alreadyDelivered = previousDeliveries.reduce((sum, item) => sum + item.quantity, 0)
      const pending = lockedRequestItem.quantity - alreadyDelivered
      if (pending <= 0) throw new Error("El ítem ya fue entregado completamente")
      if (input.quantity > pending) {
        throw new Error(`La cantidad excede el saldo pendiente de entrega (${pending})`)
      }
      totalDelivered = alreadyDelivered + input.quantity
    }

    await tx.insert(deliveries).values({
      id: deliveryId,
      code,
      deliveredBy: input.deliveredBy,
      deliveredAt: now,
      destinationType: "faena",
      worksiteId: input.worksiteId,
      workerId: null,
      receiverName: input.receiverName.trim(),
      signaturePath: null,
      notes: input.notes?.trim() || undefined,
      createdAt: now,
    })

    await tx.insert(deliveryItems).values({
      id: nanoid(),
      deliveryId,
      requestItemId: input.requestItemId ?? null,
      productId: input.productId,
      productNameFree: null,
      quantity: input.quantity,
      unitOfMeasure: input.unitOfMeasure,
      notes: null,
    })

    await applyMovementTx(tx, {
      worksiteId: input.worksiteId,
      productId: input.productId,
      type: "egreso_entrega",
      quantity: -input.quantity,
      referenceType: "delivery",
      referenceId: deliveryId,
      performedBy: input.deliveredBy,
      userEmail: input.userEmail,
      reason: `Entrega ${code} a ${worksite.name}`,
      notes: input.notes?.trim() || undefined,
    })

    if (input.requestItemId) {
      await deliverItemTx(tx, input.requestItemId, input.deliveredBy, {
        userEmail: input.userEmail,
        deliveredQuantity: input.quantity,
        totalDelivered,
      })
    }

    await recordAudit({
      userId: input.deliveredBy,
      userEmail: input.userEmail,
      action: "create",
      entityType: "delivery",
      entityId: deliveryId,
      entityCode: code,
      newState: {
        worksiteId: input.worksiteId,
        productId: input.productId,
        requestItemId: input.requestItemId ?? null,
        quantity: input.quantity,
        receiverName: input.receiverName.trim(),
      },
    }, tx)
  })

  return deliveryId
}

export async function registerWorkerEppDelivery(
  input: RegisterWorkerEppDeliveryInput,
  worksiteIds: string[] | 'all' = 'all',
): Promise<string> {
  if (!input.worksiteId) throw new Error("Selecciona una faena")
  if (worksiteIds !== 'all' && !worksiteIds.includes(input.worksiteId)) {
    throw new Error("No tienes acceso a esta faena")
  }
  if (!input.workerId) throw new Error("Selecciona un trabajador")
  if (!input.requestItemId) throw new Error("Selecciona un EPP recibido")
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("La cantidad debe ser mayor a 0")
  }

  const now = new Date().toISOString()
  const deliveryId = nanoid()
  const year = new Date().getFullYear()

  await db.transaction(async (tx) => {
    const code = await nextCodeTx(tx, "ENT", year)

    const worksite = await tx.query.worksites.findFirst({ where: eq(worksites.id, input.worksiteId) })
    const worker = await tx.query.workers.findFirst({ where: eq(workers.id, input.workerId) })

    if (!worksite || !worksite.isActive) throw new Error("Faena no disponible")
    if (!worker || !worker.isActive) throw new Error("Trabajador no disponible")
    if (worker.worksiteId !== input.worksiteId) throw new Error("El trabajador no pertenece a la faena seleccionada")

    // Lock the request item row to serialize concurrent deliveries on the same item.
    const [lockedRequestItem] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, input.requestItemId))
      .for("update")

    if (!lockedRequestItem) throw new Error("Ítem de solicitud no encontrado")
    if (!["received", "partially_delivered"].includes(lockedRequestItem.status)) {
      throw new Error("Solo puedes entregar EPP recibidos pendientes de entrega")
    }
    if (!lockedRequestItem.productId) throw new Error("El ítem recibido no tiene producto de catálogo")

    const request = await tx.query.purchaseRequests.findFirst({
      where: eq(purchaseRequests.id, lockedRequestItem.requestId),
    })
    if (!request) throw new Error("Solicitud no encontrada")
    if (request.worksiteId !== input.worksiteId) {
      throw new Error("El ítem no pertenece a la faena seleccionada")
    }

    const product = await tx.query.products.findFirst({ where: eq(products.id, lockedRequestItem.productId) })
    if (!product || !product.isActive) throw new Error("Producto no disponible")
    if (!product.isEpp) throw new Error("Solo se pueden entregar productos marcados como EPP")

    const previousDeliveries = await tx
      .select({ quantity: deliveryItems.quantity })
      .from(deliveryItems)
      .where(eq(deliveryItems.requestItemId, input.requestItemId))
    const alreadyDelivered = previousDeliveries.reduce((sum, item) => sum + item.quantity, 0)
    const pending = lockedRequestItem.quantity - alreadyDelivered
    if (pending <= 0) throw new Error("El ítem ya fue entregado completamente")
    if (input.quantity > pending) {
      throw new Error(`La cantidad excede el saldo pendiente de entrega (${pending})`)
    }

    const stock = await tx.query.worksiteStock.findFirst({
      where: and(
        eq(worksiteStock.worksiteId, input.worksiteId),
        eq(worksiteStock.productId, lockedRequestItem.productId),
      ),
    })
    if (!stock || stock.quantity < input.quantity) {
      throw new Error(`Stock insuficiente: disponible ${stock?.quantity ?? 0}, solicitado ${input.quantity}`)
    }

    const workerName = `${worker.firstName} ${worker.lastName}`.trim()
    const notes = input.notes?.trim() || undefined
    const totalDelivered = alreadyDelivered + input.quantity

    await tx.insert(deliveries).values({
      id: deliveryId,
      code,
      deliveredBy: input.deliveredBy,
      deliveredAt: now,
      destinationType: "worker",
      worksiteId: input.worksiteId,
      workerId: input.workerId,
      receiverName: workerName,
      signaturePath: null,
      notes,
      createdAt: now,
    })

    const deliveryItemId = nanoid()
    await tx.insert(deliveryItems).values({
      id: deliveryItemId,
      deliveryId,
      requestItemId: input.requestItemId,
      productId: lockedRequestItem.productId,
      productNameFree: null,
      quantity: input.quantity,
      unitOfMeasure: lockedRequestItem.unitOfMeasure,
      notes: null,
      returnQuantity: input.returnQuantity ?? null,
      returnProductId: input.returnProductId ?? null,
      returnProductNameFree: input.returnProductNameFree ?? null,
      returnReason: input.returnReason ?? null,
      returnNotes: input.returnNotes ?? null,
    })

    // Register the discarded EPP movement if a catalog product was returned
    if (input.returnQuantity && input.returnProductId) {
      await applyMovementTx(tx, {
        worksiteId: input.worksiteId,
        productId: input.returnProductId,
        type: "egreso_desecho",
        quantity: input.returnQuantity,
        referenceType: "delivery",
        referenceId: deliveryId,
        performedBy: input.deliveredBy,
        userEmail: input.userEmail,
        reason: `Retiro EPP - ${input.returnReason ?? "sin motivo"} - Entrega ${code}`,
        notes: input.returnNotes ?? undefined,
      })
    }

    if (input.proofAttachment) {
      await tx.insert(attachments).values({
        id: nanoid(),
        entityType: "delivery",
        entityId: deliveryId,
        fileName: input.proofAttachment.fileName,
        filePath: input.proofAttachment.filePath,
        fileSize: input.proofAttachment.fileSize,
        mimeType: input.proofAttachment.mimeType,
        uploadedBy: input.deliveredBy,
        uploadedAt: now,
      })
    }

    await applyMovementTx(tx, {
      worksiteId: input.worksiteId,
      productId: lockedRequestItem.productId,
      type: "egreso_entrega",
      quantity: -input.quantity,
      referenceType: "delivery",
      referenceId: deliveryId,
      performedBy: input.deliveredBy,
      userEmail: input.userEmail,
      reason: `Entrega ${code} a ${workerName}`,
      notes,
    })

    await deliverItemTx(tx, input.requestItemId, input.deliveredBy, {
      userEmail: input.userEmail,
      deliveredQuantity: input.quantity,
      totalDelivered,
    })

    await recordAudit({
      userId: input.deliveredBy,
      userEmail: input.userEmail,
      action: "create",
      entityType: "delivery",
      entityId: deliveryId,
      entityCode: code,
      newState: {
        worksiteId: input.worksiteId,
        workerId: input.workerId,
        productId: lockedRequestItem.productId,
        requestItemId: input.requestItemId,
        quantity: input.quantity,
        receiverName: workerName,
        proofFileName: input.proofAttachment?.fileName ?? null,
        returnQuantity: input.returnQuantity ?? null,
        returnProductId: input.returnProductId ?? null,
        returnProductNameFree: input.returnProductNameFree ?? null,
        returnReason: input.returnReason ?? null,
      },
    }, tx)
  })

  return deliveryId
}
