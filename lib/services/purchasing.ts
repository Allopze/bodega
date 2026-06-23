/**
 * Purchasing service — OC lifecycle: create, issue, send.
 * All DB mutations here, never in Server Actions or UI components.
 */

import fs from "node:fs/promises"
import { eq, inArray, and } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseOrderInvoices, purchaseRequestItems, quotations } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { resolveInvoiceAttachmentFile } from "@/lib/storage/config"
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

/* ── Issue OC (draft → issued) ───────────────────────────────────────────────── */

export async function issueOrder(
  orderId: string,
  userId: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
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
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (order.status !== "issued") {
      throw new Error(`Cannot mark order as sent from state '${order.status}'`)
    }

    // A-03: an empty OC must never reach 'sent'. The receipt rollup keys off
    // OC items, so a 0-item order would otherwise sit in 'sent' forever.
    const ocItems = await tx
      .select({ requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))
    if (ocItems.length === 0) {
      throw new Error("No se puede enviar una orden de compra sin ítems")
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "sent", sentAt: now, updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    // Move request items to "purchased" status

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

export async function createPurchaseOrderInvoice(
  input: CreateInvoiceInput,
  worksiteIds: string[] | 'all' = 'all',
): Promise<string> {
  return await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, input.purchaseOrderId),
      columns: { id: true, status: true, code: true, worksiteId: true },
    })
    if (worksiteIds !== 'all' && !worksiteIds.includes(order?.worksiteId ?? '')) {
      throw new Error("No tienes acceso a esta faena")
    }
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
  worksiteIds: string[] | 'all' = 'all',
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
      columns: { id: true, code: true, worksiteId: true },
    })
    if (!order) throw new Error("Orden de compra no encontrada")
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

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
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
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

/* ── Confirm order (sent → supplier_confirmed) ───────────────────────────────── */

export async function confirmOrder(
  orderId: string,
  userId: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (order.status !== "sent") {
      throw new Error(`No se puede confirmar una orden en estado '${order.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "supplier_confirmed", updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: "sent",
      toStatus:   "supplier_confirmed",
      changedBy:  userId,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: "sent" },
      newState:   { status: "supplier_confirmed" },
    }, tx)
  })
}

/* ── Close order (supplier_confirmed/partially_received/received → closed) ────── */

export async function closeOrder(
  orderId: string,
  userId: string,
  reason: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  if (!reason?.trim()) throw new Error("Se requiere un motivo para cerrar la orden")

  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (!["supplier_confirmed", "partially_received", "received"].includes(order.status)) {
      throw new Error(`No se puede cerrar una orden en estado '${order.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "closed", updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: order.status,
      toStatus:   "closed",
      changedBy:  userId,
      reason,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: order.status },
      newState:   { status: "closed" },
      reason,
    }, tx)
  })
}

/* ── Delete Order (hard delete: draft/issued/sent) ───────────────────────────── */

import {
  DELETABLE_ORDER_STATUSES,
  isOrderDeletable,
} from "@/lib/services/purchasing.constants"
export {
  DELETABLE_ORDER_STATUSES,
  isOrderDeletable,
}
export type { DeletableOrderStatus } from "@/lib/services/purchasing.constants"

/**
 * Elimina permanentemente una OC y su data dependiente.
 * Revierte los request items vinculados a pending_purchase, limpia archivos de disco.
 */
export async function deleteOrder(
  orderId: string,
  userId: string,
  worksiteIds: string[] | "all" = "all",
  opts?: { userEmail?: string },
): Promise<void> {
  // Pre-fetch invoice file paths antes de la transacción
  const invoiceFiles = await db
    .select({ filePath: purchaseOrderInvoices.filePath })
    .from(purchaseOrderInvoices)
    .where(eq(purchaseOrderInvoices.purchaseOrderId, orderId))

  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Orden ${orderId} no encontrada`)
    if (worksiteIds !== "all" && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a la faena de esta orden")
    }
    if (!isOrderDeletable(order.status)) {
      throw new Error(`No se puede eliminar una orden en estado '${order.status}'`)
    }

    const now = new Date().toISOString()

    // 1. Revertir request items vinculados a pending_purchase
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
            inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"]),
          ),
        )

      for (const reqItemId of requestItemIds) {
        await recordStatusChange(
          {
            entityType: "request_item",
            entityId:   reqItemId,
            fromStatus: "in_purchase_order",
            toStatus:   "pending_purchase",
            changedBy:  userId,
          },
          tx,
        )
      }
    }

    // 2. Desligar cotizaciones con referencia nullable a esta OC
    await tx
      .update(quotations)
      .set({ purchaseOrderId: null })
      .where(eq(quotations.purchaseOrderId, orderId))

    // 3. Auditoría antes del delete (entityId string sobrevive)
    await recordAudit(
      {
        userId,
        userEmail:  opts?.userEmail,
        action:     "delete",
        entityType: "purchase_order",
        entityId:   orderId,
        entityCode: order.code,
        oldState:   { status: order.status },
      },
      tx,
    )

    // 4. Eliminar la OC — cascade borra purchaseOrderItems e invoices
    await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, orderId))
  })

  // 5. Limpiar archivos de facturas del disco (best-effort)
  await Promise.all(
    invoiceFiles.map((f) => {
      const absPath = resolveInvoiceAttachmentFile(f.filePath)
      return absPath ? fs.unlink(absPath).catch(() => undefined) : Promise.resolve()
    }),
  )
}
