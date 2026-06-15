/**
 * Purchasing service — OC lifecycle: create, issue, send.
 * All DB mutations here, never in Server Actions or UI components.
 */

import { eq, inArray, and } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseOrderInvoices, purchaseRequestItems } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { computeOrderTotals } from "@/lib/order-totals"
import { addItemToPurchaseOrderTx } from "./item-state"

/* ── Types ──────────────────────────────────────────────────────────────────── */

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
  items:              CreateOrderItemInput[]
}

export interface CreateOrderGroupInput {
  supplierId: string
  items:      CreateOrderItemInput[]
}

export interface CreateOrdersBySupplierInput extends Omit<CreateOrderInput, "supplierId" | "items"> {
  orders: CreateOrderGroupInput[]
}

/* ── Create OC ───────────────────────────────────────────────────────────────── */

export async function createOrder(input: CreateOrderInput): Promise<string> {
  const [orderId] = await createOrdersBySupplier({
    worksiteId:         input.worksiteId,
    createdBy:          input.createdBy,
    userEmail:          input.userEmail,
    paymentTerms:       input.paymentTerms,
    estimatedDelivery:  input.estimatedDelivery,
    deliveryAddress:    input.deliveryAddress,
    notes:              input.notes,
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
      const orderId = nanoid()
      const code    = await nextCodeTx(tx, "OC", year)
      const totals  = computeOrderTotals(orderInput.items)
      orderIds.push(orderId)

      // Create the order header
      await tx.insert(purchaseOrders).values({
        id:                orderId,
        code,
        worksiteId:        input.worksiteId,
        supplierId:        orderInput.supplierId,
        createdBy:         input.createdBy,
        status:            "draft",
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

      // Insert OC items
      for (let i = 0; i < orderInput.items.length; i++) {
        const item     = orderInput.items[i]
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

/* ── Issue OC (draft → issued) ───────────────────────────────────────────────── */

export async function issueOrder(
  orderId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (order.status !== "draft") {
      throw new Error(`Cannot issue order in state '${order.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "issued", issuedAt: now, updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: "draft",
      toStatus:   "issued",
      changedBy:  userId,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: "draft" },
      newState:   { status: "issued" },
    }, tx)
  })
}

/* ── Mark as sent (issued → sent) ────────────────────────────────────────────── */

export async function markOrderSent(
  orderId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (order.status !== "issued") {
      throw new Error(`Cannot mark order as sent from state '${order.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "sent", sentAt: now, updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    // Move request items to "purchased" status
    const ocItems = await tx
      .select({ requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)

    if (requestItemIds.length > 0) {
      const itemNow = new Date().toISOString()
      await tx
        .update(purchaseRequestItems)
        .set({ status: "purchased", updatedAt: itemNow })
        .where(
          and(
            inArray(purchaseRequestItems.id, requestItemIds),
            eq(purchaseRequestItems.status, "in_purchase_order"),
          )
        )

      for (const reqItemId of requestItemIds) {
        await recordStatusChange({
          entityType: "request_item",
          entityId:   reqItemId,
          fromStatus: "in_purchase_order",
          toStatus:   "purchased",
          changedBy:  userId,
        }, tx)
      }
    }

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: "issued",
      toStatus:   "sent",
      changedBy:  userId,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: "issued" },
      newState:   { status: "sent" },
    }, tx)
  })
}

/* ── Purchase Order Invoices ─────────────────────────────────────────────────── */

const INVOICE_ALLOWED_STATUSES = new Set([
  "issued", "sent", "supplier_confirmed",
  "partially_office_received", "office_received",
  "partially_received", "received", "closed",
])

export interface CreateInvoiceInput {
  purchaseOrderId: string
  invoiceNumber:   string
  amount:          number
  issueDate?:      string | null
  fileName:        string
  filePath:        string
  fileSize?:       number | null
  mimeType?:       string | null
  uploadedBy:      string
  userEmail?:      string
}

export interface DeleteInvoiceResult {
  filePath: string
}

export async function createPurchaseOrderInvoice(input: CreateInvoiceInput): Promise<string> {
  return await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, input.purchaseOrderId),
      columns: { id: true, status: true, code: true },
    })
    if (!order) {
      throw new Error("Orden de compra no encontrada")
    }
    if (!INVOICE_ALLOWED_STATUSES.has(order.status)) {
      throw new Error(
        `No se puede adjuntar factura a una OC en estado '${order.status}'`
      )
    }

    const invoiceId = nanoid()
    await tx.insert(purchaseOrderInvoices).values({
      id:              invoiceId,
      purchaseOrderId: input.purchaseOrderId,
      invoiceNumber:   input.invoiceNumber,
      amount:          input.amount,
      issueDate:       input.issueDate ?? null,
      fileName:        input.fileName,
      filePath:        input.filePath,
      fileSize:        input.fileSize ?? null,
      mimeType:        input.mimeType ?? null,
      uploadedBy:      input.uploadedBy,
    })

    await recordAudit({
      userId:     input.uploadedBy,
      userEmail:  input.userEmail,
      action:     "create",
      entityType: "purchase_order_invoice",
      entityId:   invoiceId,
      entityCode: input.invoiceNumber,
      newState:   {
        purchaseOrderId: input.purchaseOrderId,
        purchaseOrderCode: order.code,
        amount: input.amount,
        issueDate: input.issueDate,
      },
    }, tx)

    return invoiceId
  })
}

export async function deletePurchaseOrderInvoice(
  invoiceId: string,
  userId: string,
  opts?: { userEmail?: string },
): Promise<DeleteInvoiceResult> {
  return await db.transaction(async (tx) => {
    const invoice = await tx.query.purchaseOrderInvoices.findFirst({
      where: eq(purchaseOrderInvoices.id, invoiceId),
    })
    if (!invoice) {
      throw new Error("Factura no encontrada")
    }

    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, invoice.purchaseOrderId),
      columns: { id: true, code: true },
    })

    await tx.delete(purchaseOrderInvoices).where(eq(purchaseOrderInvoices.id, invoiceId))

    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "delete",
      entityType: "purchase_order_invoice",
      entityId:   invoiceId,
      entityCode: invoice.invoiceNumber,
      oldState:   {
        purchaseOrderId:   invoice.purchaseOrderId,
        purchaseOrderCode: order?.code,
        amount:            invoice.amount,
      },
    }, tx)

    return { filePath: invoice.filePath }
  })
}

/* ── Cancel Order (draft/issued/sent → cancelled) ────────────────────────────── */

export async function cancelOrder(
  orderId: string,
  userId: string,
  reason: string,
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (!["draft", "issued", "sent"].includes(order.status)) {
      throw new Error(`Cannot cancel order in status '${order.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    // Move associated request items back to "pending_purchase" status
    const ocItems = await tx
      .select({ id: purchaseOrderItems.id, requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)

    if (requestItemIds.length > 0) {
      await tx
        .update(purchaseRequestItems)
        .set({ status: "pending_purchase", updatedAt: now })
        .where(
          and(
            inArray(purchaseRequestItems.id, requestItemIds),
            inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"])
          )
        )

      for (const reqItemId of requestItemIds) {
        await recordStatusChange({
          entityType: "request_item",
          entityId:   reqItemId,
          fromStatus: "purchased",
          toStatus:   "pending_purchase",
          changedBy:  userId,
        }, tx)
      }
    }

    // Update purchaseOrderItems status to cancelled
    await tx
      .update(purchaseOrderItems)
      .set({ status: "cancelled" })
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: order.status,
      toStatus:   "cancelled",
      changedBy:  userId,
    }, tx)

    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: order.status },
      newState:   { status: "cancelled" },
      reason,
    }, tx)
  })
}
