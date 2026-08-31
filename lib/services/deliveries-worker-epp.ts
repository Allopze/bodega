import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  attachments, deliveries, deliveryItems,
  products, purchaseOrderItems, purchaseRequestItems, purchaseRequests, workers, worksites, worksiteStock,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { deliverItemTx } from "@/lib/services/item-state"
import { applyMovementTx } from "@/lib/services/stock"
import { getTraceableDeliveryBalance } from "@/lib/services/delivery-eligibility"
import { onEppDeliveryCompleted } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import type { RegisterWorkerEppDeliveryInput } from "./deliveries.types"

/** N°62: "Registrar la entrega de los EPP y dejar documentada su entrega". */
const PDTP_EPP_DELIVERY_ACTIVITY_NUMBER = 62

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
  if (!Number.isInteger(input.quantity)) {
    throw new Error("Los EPP se entregan en cantidades enteras")
  }

  const now = new Date().toISOString()
  const deliveryId = nanoid()
  const year = new Date().getFullYear()

  await db.transaction(async (tx) => {
    const code = await nextCodeTx(tx, "ENT", year)

    const [worksite, worker] = await Promise.all([
      tx.query.worksites.findFirst({ where: eq(worksites.id, input.worksiteId) }),
      tx.query.workers.findFirst({ where: eq(workers.id, input.workerId) }),
    ])

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
    if (!["partially_received", "received", "partially_delivered"].includes(lockedRequestItem.status)) {
      throw new Error("Solo puedes entregar EPP recibidos pendientes de entrega")
    }
    if (!lockedRequestItem.productId) throw new Error("El ítem recibido no tiene producto de catálogo")
    if (lockedRequestItem.workerId && lockedRequestItem.workerId !== input.workerId) {
      throw new Error("El EPP fue solicitado para otro trabajador")
    }

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

    // B-5: productos EPP sin familia no se cruzan con la matriz de requisitos de prevención.
    // La entrega continúa (es válida operacionalmente) pero se registra para corrección de datos.
    if (!product.familyId) {
      logger.warn(
        `[registerWorkerEppDelivery] Producto ${product.id} (${product.name}) no tiene familyId. ` +
        "La entrega se registrará correctamente pero no contribuirá a la cobertura de prevención EPP.",
      )
    }

    const previousDeliveries = await tx
      .select({ quantity: deliveryItems.quantity })
      .from(deliveryItems)
      .where(eq(deliveryItems.requestItemId, input.requestItemId))
    const alreadyDelivered = previousDeliveries.reduce((sum, item) => sum + item.quantity, 0)

    // LOG-5/DAT-13: el saldo entregable no puede superar lo que de verdad
    // llegó a faena para este ítem (ver el mismo cap en deliveries-worksite.ts).
    const [receivedRow] = await tx
      .select({ received: sql<number>`coalesce(sum(${purchaseOrderItems.quantityReceived}), 0)` })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.requestItemId, input.requestItemId))
    const receivedAtFaena = Number(receivedRow?.received ?? 0)

    if (lockedRequestItem.quantity <= alreadyDelivered) throw new Error("El ítem ya fue entregado completamente")
    const pending = getTraceableDeliveryBalance({
      requestedQuantity: lockedRequestItem.quantity,
      receivedAtFaena,
      deliveredQuantity: alreadyDelivered,
    })
    if (pending <= 0) throw new Error("No hay saldo recibido en faena pendiente de entregar")
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
    const receiverName = input.receiverName?.trim() || workerName
    const notes = input.notes?.trim() || undefined
    const totalDelivered = alreadyDelivered + input.quantity

    await tx.insert(deliveries).values({
      id: deliveryId,
      code,
      deliveredBy: input.deliveredBy,
      deliveredAt: now,
      destinationType: "worker",
      sourceWorksiteId: input.worksiteId,
      worksiteId: input.worksiteId,
      workerId: input.workerId,
      receiverName,
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

    // The returned unit comes from the worker, not from warehouse stock.
    if (input.returnQuantity && input.returnProductId) {
      await applyMovementTx(tx, {
        worksiteId: input.worksiteId,
        productId: input.returnProductId,
        type: "retiro_epp_trabajador",
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

  // N°62 del PDTP ("Registrar la entrega de los EPP y dejar documentada su
  // entrega a los trabajadores"). El conector existía desde la fase 2 del motor
  // de acreditación y nunca tuvo llamador. Va fuera de la transacción y no
  // propaga error: la entrega ya está registrada y la acreditación se reintenta.
  //
  // Es una entrega por trabajador, así que `workerCount` es 1. La N°23 —entrega
  // inicial al ingresar— se cuenta aparte desde Habilitación del trabajador.
  await onEppDeliveryCompleted({
    deliveryId,
    worksiteId: input.worksiteId,
    deliveredAt: now,
    workerCount: 1,
    activityNumbers: [PDTP_EPP_DELIVERY_ACTIVITY_NUMBER],
  })

  return deliveryId
}
