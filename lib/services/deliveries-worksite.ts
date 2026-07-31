import { eq } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries, deliveryItems,
  products, purchaseRequestItems, worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { deliverItemTx } from "@/lib/services/item-state"
import { applyMovementTx } from "@/lib/services/stock"
import type { RegisterWorksiteDeliveryInput } from "./deliveries.types"

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
      if (!["partially_received", "received", "partially_delivered"].includes(lockedRequestItem.status)) {
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

    const deliveryItemId = nanoid()
    await tx.insert(deliveryItems).values({
      id: deliveryItemId,
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
