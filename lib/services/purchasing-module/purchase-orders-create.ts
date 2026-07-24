/**
 * Purchase order creation service.
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseRequestItems, requestItemAttributes } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { computeOrderTotals } from "@/lib/order-totals"
import { addItemToPurchaseOrderTx } from "../item-state"

export interface CreateOrderItemInput {
  requestItemId: string
  productId:     string | null
  productNameFree: string | null
  quantity:      number
  unitOfMeasure: string
  unitPrice:     number
  discount?:     number
  notes?:        string | null
  sortOrder?:    number
}

export interface CreateOrderInput {
  worksiteId:         string
  supplierId:         string
  createdBy:          string
  userEmail?:         string
  paymentTerms?:      string | null
  estimatedDelivery?: string | null
  deliveryAddress?:   string | null
  notes?:             string | null
  deliveryMode?:      "via_oficina" | "directo_faena"
  items:              CreateOrderItemInput[]
}

export interface CreateOrderGroupInput {
  supplierId: string
  items:      CreateOrderItemInput[]
}

export interface CreateOrdersBySupplierInput extends Omit<CreateOrderInput, "supplierId" | "items"> {
  orders: CreateOrderGroupInput[]
}

export async function createOrder(input: CreateOrderInput): Promise<string> {
  const [orderId] = await createOrdersBySupplier({
    worksiteId:         input.worksiteId,
    createdBy:          input.createdBy,
    userEmail:          input.userEmail,
    paymentTerms:       input.paymentTerms,
    estimatedDelivery:  input.estimatedDelivery,
    deliveryAddress:    input.deliveryAddress,
    notes:              input.notes,
    deliveryMode:       input.deliveryMode,
    orders: [{
      supplierId: input.supplierId,
      items:      input.items,
    }],
  })
  return orderId!
}

export async function createOrdersBySupplier(input: CreateOrdersBySupplierInput): Promise<string[]> {
  if (input.orders.length === 0) throw new Error("No hay órdenes para crear")
  if (input.orders.some((order) => order.items.length === 0)) {
    throw new Error("No se puede crear una OC sin ítems")
  }

  const now       = new Date().toISOString()
  const year      = new Date().getFullYear()
  const orderIds: string[] = []

  await db.transaction(async (tx) => {
    for (const orderInput of input.orders) {
      for (const item of orderInput.items) {
        const requestItem = await tx.query.purchaseRequestItems.findFirst({
          where: eq(purchaseRequestItems.id, item.requestItemId),
        })
        if (!requestItem) throw new Error(`Item ${item.requestItemId} not found`)
        if (item.quantity > requestItem.quantity) {
          throw new Error("La cantidad a comprar no puede superar la cantidad aprobada del ítem")
        }

        // Compra parcial: el remanente se separa en un ítem hermano que conserva
        // el estado original (approved/pending_purchase), para que vuelva al
        // consolidado de "ítems sin OC" en vez de perderse silenciosamente.
        if (item.quantity < requestItem.quantity) {
          const siblingId = nanoid()
          const remainder = requestItem.quantity - item.quantity

          await tx.insert(purchaseRequestItems).values({
            id:                  siblingId,
            requestId:           requestItem.requestId,
            productId:           requestItem.productId,
            productNameFree:     requestItem.productNameFree,
            quantity:            remainder,
            unitOfMeasure:       requestItem.unitOfMeasure,
            status:              requestItem.status,
            urgency:             requestItem.urgency,
            requiredDate:        requestItem.requiredDate,
            workerId:            requestItem.workerId,
            suggestedSupplierId: requestItem.suggestedSupplierId,
            supplierHint:        requestItem.supplierHint,
            sortOrder:           requestItem.sortOrder,
            notes:               requestItem.notes,
          })

          const attrs = await tx.query.requestItemAttributes.findMany({
            where: eq(requestItemAttributes.requestItemId, requestItem.id),
          })
          if (attrs.length > 0) {
            await tx.insert(requestItemAttributes).values(
              attrs.map((a) => ({
                id:            nanoid(),
                requestItemId: siblingId,
                attributeId:   a.attributeId,
                attributeName: a.attributeName,
                value:         a.value,
              })),
            )
          }

          await tx
            .update(purchaseRequestItems)
            .set({ quantity: item.quantity, updatedAt: new Date().toISOString() })
            .where(eq(purchaseRequestItems.id, requestItem.id))

          await recordAudit({
            userId:     input.createdBy,
            userEmail:  input.userEmail,
            action:     "update",
            entityType: "request_item",
            entityId:   requestItem.id,
            oldState:   { quantity: requestItem.quantity },
            newState:   { quantity: item.quantity, splitIntoItemId: siblingId, splitRemainder: remainder },
          }, tx)
        }
      }

      const orderId = nanoid()
      const code    = await nextCodeTx(tx, "OC", year)
      const totals  = computeOrderTotals(orderInput.items)
      orderIds.push(orderId)

      await tx.insert(purchaseOrders).values({
        id:                orderId,
        code,
        worksiteId:        input.worksiteId,
        supplierId:        orderInput.supplierId,
        createdBy:         input.createdBy,
        status:            "draft",
        deliveryMode:      input.deliveryMode ?? "via_oficina",
        paymentTerms:      input.paymentTerms ?? null,
        estimatedDelivery: input.estimatedDelivery ?? null,
        deliveryAddress:   input.deliveryAddress ?? null,
        notes:             input.notes ?? null,
        netAmount:         totals.netAmount,
        taxAmount:         totals.taxAmount,
        totalAmount:       totals.totalAmount,
        createdAt:         now,
        updatedAt:         now,
      })

      for (const [i, item] of orderInput.items.entries()) {
        const subtotal = Math.round(
          item.quantity * item.unitPrice * (1 - (item.discount ?? 0) / 100)
        )
        await tx.insert(purchaseOrderItems).values({
          id:              nanoid(),
          purchaseOrderId: orderId,
          requestItemId:   item.requestItemId,
          productId:       item.productId,
          productNameFree: item.productNameFree,
          quantity:        item.quantity,
          unitOfMeasure:   item.unitOfMeasure,
          unitPrice:       item.unitPrice,
          discount:        item.discount ?? 0,
          subtotal,
          quantityReceived: 0,
          status:          "issued",
          sortOrder:       item.sortOrder ?? i,
          notes:           item.notes ?? null,
        })
      }

      await recordAudit({
        userId:     input.createdBy,
        userEmail:  input.userEmail,
        action:     "create",
        entityType: "purchase_order",
        entityId:   orderId,
        entityCode: code,
        newState:   {
          status:      "draft",
          supplierId:  orderInput.supplierId,
          totalAmount: totals.totalAmount,
          itemCount:   orderInput.items.length,
        },
      }, tx)

      for (const item of orderInput.items) {
        await addItemToPurchaseOrderTx(tx, item.requestItemId, orderId, input.createdBy, {
          userEmail: input.userEmail,
        })
      }
    }
  })

  return orderIds
}
