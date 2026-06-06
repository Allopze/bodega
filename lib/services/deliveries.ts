import { and, count, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries, deliveryItems, inventoryMovements,
  products, warehouseStock, warehouses, worksites,
} from "@/db/schema"
import { generateCode, nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"

export interface RegisterWorksiteDeliveryInput {
  warehouseId: string
  worksiteId: string
  productId: string
  quantity: number
  unitOfMeasure: string
  receiverName: string
  deliveredBy: string
  userEmail?: string
  notes?: string | null
}

export async function registerWorksiteDelivery(input: RegisterWorksiteDeliveryInput): Promise<string> {
  if (!input.warehouseId) throw new Error("Selecciona una bodega")
  if (!input.worksiteId) throw new Error("Selecciona una faena")
  if (!input.productId) throw new Error("Selecciona un producto")
  if (!input.receiverName.trim()) throw new Error("Indica quién recibió")
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("La cantidad debe ser mayor a 0")
  }

  const [{ total }] = await db.select({ total: count() }).from(deliveries)
  const now = new Date().toISOString()
  const deliveryId = nanoid()
  const code = generateCode("ENT", total + 1, new Date().getFullYear())

  await db.transaction(async (tx) => {
    const [warehouse, worksite, product, stock] = await Promise.all([
      tx.query.warehouses.findFirst({ where: eq(warehouses.id, input.warehouseId) }),
      tx.query.worksites.findFirst({ where: eq(worksites.id, input.worksiteId) }),
      tx.query.products.findFirst({ where: eq(products.id, input.productId) }),
      tx.query.warehouseStock.findFirst({
        where: and(
          eq(warehouseStock.warehouseId, input.warehouseId),
          eq(warehouseStock.productId, input.productId),
        ),
      }),
    ])

    if (!warehouse || !warehouse.isActive) throw new Error("Bodega no disponible")
    if (!worksite || !worksite.isActive) throw new Error("Faena no disponible")
    if (!product || !product.isActive) throw new Error("Producto no disponible")

    const currentQty = stock?.quantity ?? 0
    const stockAfter = currentQty - input.quantity
    if (stockAfter < 0) {
      throw new Error(`Stock insuficiente: disponible ${currentQty}, solicitado ${input.quantity}`)
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
      notes: input.notes?.trim() || null,
      createdAt: now,
    })

    await tx.insert(deliveryItems).values({
      id: nanoid(),
      deliveryId,
      requestItemId: null,
      productId: input.productId,
      productNameFree: null,
      quantity: input.quantity,
      unitOfMeasure: input.unitOfMeasure,
      notes: null,
    })

    if (stock) {
      await tx
        .update(warehouseStock)
        .set({
          quantity: stockAfter,
          lastMovementAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(warehouseStock.warehouseId, input.warehouseId),
            eq(warehouseStock.productId, input.productId),
          ),
        )
    }

    await tx.insert(inventoryMovements).values({
      id: nanoid(),
      warehouseId: input.warehouseId,
      productId: input.productId,
      type: "egreso_faena",
      quantity: -input.quantity,
      referenceType: "delivery",
      referenceId: deliveryId,
      stockBefore: currentQty,
      stockAfter,
      performedBy: input.deliveredBy,
      performedAt: now,
      reason: `Entrega ${code} a ${worksite.name}`,
      notes: input.notes?.trim() || null,
    })
  })

  await recordAudit({
    userId: input.deliveredBy,
    userEmail: input.userEmail,
    action: "create",
    entityType: "delivery",
    entityId: deliveryId,
    entityCode: code,
    newState: {
      warehouseId: input.warehouseId,
      worksiteId: input.worksiteId,
      productId: input.productId,
      quantity: input.quantity,
      receiverName: input.receiverName.trim(),
    },
  })

  return deliveryId
}
