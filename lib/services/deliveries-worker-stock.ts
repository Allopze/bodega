import { eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  attachments,
  deliveries,
  deliveryItems,
  products,
  purchaseOrderItems,
  purchaseRequestItems,
  purchaseRequests,
  workers,
  worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nextCodeTx } from "@/lib/code-sequences"
import { nanoid } from "@/lib/id"
import { getTraceableDeliveryBalance } from "@/lib/services/delivery-eligibility"
import { deliverItemTx } from "@/lib/services/item-state"
import { applyMovementTx } from "@/lib/services/stock"
import { codeYear, todayInChile } from "@/lib/utils"
import type {
  RegisterWorkerStockDeliveryInput,
  WorkerStockDeliveryItemInput,
} from "./deliveries.types"

interface TraceableItemState {
  requestItemId: string
  totalDelivered: number
}

function normalizeItems(items: WorkerStockDeliveryItemInput[]): WorkerStockDeliveryItemInput[] {
  if (items.length === 0) throw new Error("Agrega al menos un producto a la entrega")
  if (items.length > 50) throw new Error("Máximo 50 productos por entrega")

  const productIds = new Set<string>()
  const requestItemIds = new Set<string>()

  for (const item of items) {
    if (!item.productId) throw new Error("Cada línea debe tener un producto")
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error("La cantidad de cada producto debe ser mayor a 0")
    }
    if (productIds.has(item.productId)) {
      throw new Error("No repitas un producto en la misma entrega")
    }
    productIds.add(item.productId)

    if (item.requestItemId) {
      if (requestItemIds.has(item.requestItemId)) {
        throw new Error("No repitas un ítem de solicitud en la misma entrega")
      }
      requestItemIds.add(item.requestItemId)
    }
  }

  // A stable lock order avoids a cross-product deadlock if two operators enter
  // the same lines in different visual orders.
  return [...items].sort((left, right) => left.productId.localeCompare(right.productId))
}

async function getTraceableItemState(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  item: WorkerStockDeliveryItemInput,
  workerId: string,
  workerWorksiteId: string,
  sourceWorksiteId: string,
): Promise<TraceableItemState | null> {
  if (!item.requestItemId) return null

  if (sourceWorksiteId !== workerWorksiteId) {
    throw new Error("Un ítem trazable debe entregarse desde el stock de la faena del trabajador")
  }

  const [requestItem] = await tx
    .select()
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.id, item.requestItemId))
    .for("update")
  if (!requestItem) throw new Error("Ítem de solicitud no encontrado")
  if (![
    "partially_received",
    "received",
    "partially_delivered",
  ].includes(requestItem.status)) {
    throw new Error("Solo puedes asociar ítems recibidos pendientes de entrega")
  }
  if (requestItem.productId !== item.productId) {
    throw new Error("El ítem trazable no coincide con el producto")
  }
  if (requestItem.workerId && requestItem.workerId !== workerId) {
    throw new Error("El producto fue solicitado para otro trabajador")
  }

  const request = await tx.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestItem.requestId),
  })
  if (!request || request.worksiteId !== workerWorksiteId) {
    throw new Error("El ítem no pertenece a la faena del trabajador")
  }

  const previousDeliveries = await tx
    .select({ quantity: deliveryItems.quantity })
    .from(deliveryItems)
    .where(eq(deliveryItems.requestItemId, item.requestItemId))
  const alreadyDelivered = previousDeliveries.reduce((sum, delivery) => sum + delivery.quantity, 0)

  const [receivedRow] = await tx
    .select({ received: sql<number>`coalesce(sum(${purchaseOrderItems.quantityReceived}), 0)` })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.requestItemId, item.requestItemId))
  const receivedAtFaena = Number(receivedRow?.received ?? 0)
  const pending = getTraceableDeliveryBalance({
    requestedQuantity: requestItem.quantity,
    receivedAtFaena,
    deliveredQuantity: alreadyDelivered,
  })

  if (pending <= 0) throw new Error("No hay saldo recibido en faena pendiente de entregar")
  if (item.quantity > pending) {
    throw new Error(`La cantidad excede el saldo pendiente de entrega (${pending})`)
  }

  return {
    requestItemId: item.requestItemId,
    totalDelivered: alreadyDelivered + item.quantity,
  }
}

/**
 * Registers a physical stock delivery to one worker.
 *
 * The header, all delivery lines and all stock movements share one database
 * transaction. `applyMovementTx` performs the conditional stock decrement, so
 * a stale screen can never produce negative stock.
 */
export async function registerWorkerStockDelivery(
  input: RegisterWorkerStockDeliveryInput,
  worksiteIds: string[] | "all" = "all",
): Promise<string> {
  if (!input.sourceWorksiteId) throw new Error("Selecciona la bodega de origen")
  if (!input.workerId) throw new Error("Selecciona un trabajador")

  const items = normalizeItems(input.items)
  const deliveryId = nanoid()
  const now = new Date().toISOString()
  // La fecha civil retroactiva se ancla al mediodía UTC (08:00–09:00 en Chile):
  // con T00:00:00Z el timestamp cae en las 20:00 del día anterior chileno y
  // `formatDate` —que renderiza en America/Santiago— mostraría un día menos.
  // Si la fecha elegida es hoy se conserva `now`, para no perder la hora real ni
  // el orden intradía de las entregas del día.
  const deliveredAt = input.deliveredAt && input.deliveredAt !== todayInChile()
    ? `${input.deliveredAt}T12:00:00.000Z`
    : now
  const year = codeYear()

  await db.transaction(async (tx) => {
    const [sourceWorksite, worker] = await Promise.all([
      tx.query.worksites.findFirst({ where: eq(worksites.id, input.sourceWorksiteId) }),
      tx.query.workers.findFirst({ where: eq(workers.id, input.workerId) }),
    ])

    if (!sourceWorksite || !sourceWorksite.isActive) throw new Error("Bodega de origen no disponible")
    if (!worker || !worker.isActive) throw new Error("Trabajador no disponible")
    if (worksiteIds !== "all" && (
      !worksiteIds.includes(sourceWorksite.id) || !worksiteIds.includes(worker.worksiteId)
    )) {
      throw new Error("No tienes acceso a la bodega o faena de esta entrega")
    }
    if (worker.worksiteId !== sourceWorksite.id) {
      throw new Error("El trabajador no pertenece a la faena seleccionada")
    }

    const targetWorksite = sourceWorksite

    const code = await nextCodeTx(tx, "ENT", year)
    const workerName = `${worker.firstName} ${worker.lastName}`.trim()
    const receiverName = input.receiverName?.trim() || workerName
    const notes = input.notes?.trim() || null

    await tx.insert(deliveries).values({
      id: deliveryId,
      code,
      deliveredBy: input.deliveredBy,
      deliveredAt,
      destinationType: "worker",
      sourceWorksiteId: sourceWorksite.id,
      worksiteId: targetWorksite.id,
      workerId: worker.id,
      receiverName,
      // Signature evidence is only preserved on historical records. New
      // deliveries do not collect or persist one.
      signaturePath: null,
      notes,
      createdAt: now,
    })

    const auditItems: Array<{ productId: string; quantity: number; requestItemId: string | null }> = []
    for (const item of items) {
      const product = await tx.query.products.findFirst({ where: eq(products.id, item.productId) })
      if (!product || !product.isActive) throw new Error("Producto no disponible")
      if (product.isService) throw new Error("Los servicios no se entregan desde bodega")

      const traceableState = await getTraceableItemState(
        tx,
        item,
        worker.id,
        targetWorksite.id,
        sourceWorksite.id,
      )

      await tx.insert(deliveryItems).values({
        id: nanoid(),
        deliveryId,
        requestItemId: traceableState?.requestItemId ?? null,
        productId: product.id,
        productNameFree: null,
        quantity: item.quantity,
        unitOfMeasure: product.unitOfMeasure,
        notes: item.notes?.trim() || null,
      })

      await applyMovementTx(tx, {
        worksiteId: sourceWorksite.id,
        productId: product.id,
        type: "egreso_entrega",
        quantity: -item.quantity,
        referenceType: "delivery",
        referenceId: deliveryId,
        performedBy: input.deliveredBy,
        userEmail: input.userEmail,
        reason: `Entrega ${code} a ${workerName}`,
        notes: notes ?? undefined,
      })

      if (traceableState) {
        await deliverItemTx(tx, traceableState.requestItemId, input.deliveredBy, {
          userEmail: input.userEmail,
          deliveredQuantity: item.quantity,
          totalDelivered: traceableState.totalDelivered,
        })
      }

      auditItems.push({
        productId: product.id,
        quantity: item.quantity,
        requestItemId: traceableState?.requestItemId ?? null,
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

    await recordAudit({
      userId: input.deliveredBy,
      userEmail: input.userEmail,
      action: "create",
      entityType: "delivery",
      entityId: deliveryId,
      entityCode: code,
      newState: {
        sourceWorksiteId: sourceWorksite.id,
        worksiteId: targetWorksite.id,
        workerId: worker.id,
        receiverName,
        items: auditItems,
        proofFileName: input.proofAttachment?.fileName ?? null,
      },
    }, tx)
  })

  return deliveryId
}
