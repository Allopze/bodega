import { count, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries, deliveryItems,
  products, worksites,
} from "@/db/schema"
import { generateCode, nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { deliverItemTx } from "@/lib/services/item-state"
import { applyMovementTx } from "@/lib/services/warehouse"

export interface RegisterWorksiteDeliveryInput {
  warehouseId: string
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
    const [worksite, product] = await Promise.all([
      tx.query.worksites.findFirst({ where: eq(worksites.id, input.worksiteId) }),
      tx.query.products.findFirst({ where: eq(products.id, input.productId) }),
    ])

    if (!worksite || !worksite.isActive) throw new Error("Faena no disponible")
    if (!product || !product.isActive) throw new Error("Producto no disponible")

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
      warehouseId: input.warehouseId,
      productId: input.productId,
      type: "egreso_faena",
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
        warehouseId: input.warehouseId,
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
