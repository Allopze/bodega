/**
 * Invoice management for purchase orders.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderInvoices, purchaseOrderInvoiceItems, purchaseOrderItems } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"

/* ── Purchase Order Invoices ─────────────────────────────────────────────────── */

const INVOICE_ALLOWED_STATUSES = new Set([
  "sent",
  "partially_office_received", "office_received",
  "partially_received", "received", "closed",
])

export interface CreateInvoiceItemInput {
  purchaseOrderItemId?: string | null
  productName:          string
  productCode?:         string | null
  unitOfMeasure?:       string | null
  quantity:             number
  unitPrice:            number
  subtotal:             number
}

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
  items?:          CreateInvoiceItemInput[]
}

export interface DeleteInvoiceResult {
  filePath: string
}

export async function createPurchaseOrderInvoice(
  input: CreateInvoiceInput,
  worksiteIds: string[] | 'all' = 'all',
): Promise<string> {
  return await db.transaction(async (tx) => {
    if (!Number.isFinite(input.amount) || input.amount < 0) {
      throw new Error("Monto de factura inválido")
    }
    const invoiceItems = normalizeInvoiceItems(input.items)
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

    const invoiceNumber = input.invoiceNumber.trim()
    const existingInvoice = await tx.query.purchaseOrderInvoices.findFirst({
      where: and(
        eq(purchaseOrderInvoices.purchaseOrderId, input.purchaseOrderId),
        eq(purchaseOrderInvoices.invoiceNumber, invoiceNumber),
      ),
      columns: { id: true },
    })
    if (existingInvoice) {
      throw new Error("Ya existe una factura con ese folio para esta OC")
    }

    const linkedItemIds = invoiceItems
      .map((item) => item.purchaseOrderItemId)
      .filter((id): id is string => Boolean(id))
    if (new Set(linkedItemIds).size !== linkedItemIds.length) {
      throw new Error("La factura no puede repetir líneas de la OC")
    }
    if (linkedItemIds.length > 0) {
      const validItems = await tx
        .select({ id: purchaseOrderItems.id })
        .from(purchaseOrderItems)
        .where(and(
          eq(purchaseOrderItems.purchaseOrderId, input.purchaseOrderId),
          inArray(purchaseOrderItems.id, linkedItemIds),
        ))
      if (validItems.length !== linkedItemIds.length) {
        throw new Error("La factura contiene una línea que no pertenece a esta OC")
      }
    }

    const invoiceId = nanoid()

    // Calculate total from items if provided, otherwise use the provided amount
    const totalAmount = invoiceItems.length > 0
      ? invoiceItems.reduce((sum, item) => sum + item.subtotal, 0)
      : input.amount

    await tx.insert(purchaseOrderInvoices).values({
      id:              invoiceId,
      purchaseOrderId: input.purchaseOrderId,
      invoiceNumber,
      amount:          totalAmount,
      issueDate:       input.issueDate ?? null,
      fileName:        input.fileName,
      filePath:        input.filePath,
      fileSize:        input.fileSize ?? null,
      mimeType:        input.mimeType ?? null,
      uploadedBy:      input.uploadedBy,
    })

    // Insert invoice items if provided
    if (invoiceItems.length > 0) {
      await tx.insert(purchaseOrderInvoiceItems).values(
        invoiceItems.map((item) => ({
          id:                  nanoid(),
          invoiceId,
          purchaseOrderItemId: item.purchaseOrderItemId ?? null,
          productName:         item.productName,
          productCode:         item.productCode ?? null,
          unitOfMeasure:       item.unitOfMeasure ?? null,
          quantity:            item.quantity,
          unitPrice:           item.unitPrice,
          subtotal:            item.subtotal,
        }))
      )
    }

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
        amount: totalAmount,
        issueDate: input.issueDate,
      },
    }, tx)

    return invoiceId
  })
}

function normalizeInvoiceItems(items: CreateInvoiceItemInput[] | undefined) {
  return (items ?? []).map((item, index) => {
    if (!item.productName.trim()) throw new Error(`La línea ${index + 1} no tiene descripción`)
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error(`Cantidad inválida en la línea ${index + 1}`)
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error(`Precio inválido en la línea ${index + 1}`)

    return {
      ...item,
      productName: item.productName.trim(),
      productCode: item.productCode?.trim() || null,
      unitOfMeasure: item.unitOfMeasure?.trim() || null,
      // Ignore any browser-provided subtotal. This service is also called by
      // non-UI flows, so the invariant belongs at the transactional boundary.
      subtotal: roundMoney(item.quantity * item.unitPrice),
    }
  })
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
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

/* ── Invoice Reconciliation ──────────────────────────────────────────────── */

export interface InvoiceReconciliationItem {
  ocItemId:       string
  productName:    string
  ocQuantity:     number
  invoicedQty:    number
  matched:        boolean
  difference:     number
}

export interface InvoiceReconciliationResult {
  hasInvoices:       boolean
  totalInvoiced:     number
  totalOC:           number
  items:             InvoiceReconciliationItem[]
  uncoveredItems:    Array<{ ocItemId: string; productName: string; ocQuantity: number }>
  warnings:          string[]
}

/**
 * Check invoice ↔ OC item reconciliation for a purchase order.
 * Returns warnings but does NOT block the close operation.
 */
export async function reconcileOrderInvoices(
  orderId: string,
): Promise<InvoiceReconciliationResult> {
  const [order, ocItems, invoices] = await Promise.all([
    db.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
      columns: { totalAmount: true },
    }),
    db.query.purchaseOrderItems.findMany({
      where: eq(purchaseOrderItems.purchaseOrderId, orderId),
      columns: {
        id: true,
        productId: true,
        productNameFree: true,
        quantity: true,
      },
    }),
    db.query.purchaseOrderInvoices.findMany({
      where: eq(purchaseOrderInvoices.purchaseOrderId, orderId),
      with: { items: true },
    }),
  ])

  const totalOC = order?.totalAmount ?? 0
  const totalInvoiced = invoices.reduce((sum, inv) => sum + (inv.amount ?? 0), 0)
  const hasInvoices = invoices.length > 0

  // Build a map: ocItemId → invoiced quantity (from invoice items linked to OC items)
  const invoicedQtyMap = new Map<string, number>()
  for (const invoice of invoices) {
    for (const item of invoice.items) {
      if (item.purchaseOrderItemId) {
        const current = invoicedQtyMap.get(item.purchaseOrderItemId) ?? 0
        invoicedQtyMap.set(item.purchaseOrderItemId, current + item.quantity)
      }
    }
  }

  // Also handle invoices without line items (legacy) — treat total as matching if amount matches
  const hasLineItems = invoices.some((inv) => inv.items.length > 0)

  const items: InvoiceReconciliationItem[] = ocItems.map((ocItem) => {
    const invoicedQty = invoicedQtyMap.get(ocItem.id) ?? 0
    const difference = ocItem.quantity - invoicedQty
    const matched = Math.abs(difference) < 0.01 // floating point tolerance
    const productName = ocItem.productNameFree ?? ocItem.productId ?? "Ítem"
    return {
      ocItemId: ocItem.id,
      productName,
      ocQuantity: ocItem.quantity,
      invoicedQty,
      matched,
      difference,
    }
  })

  const uncoveredItems = items
    .filter((item) => item.invoicedQty === 0)
    .map(({ ocItemId, productName, ocQuantity }) => ({ ocItemId, productName, ocQuantity }))

  const warnings: string[] = []
  if (!hasInvoices) {
    warnings.push("No hay facturas adjuntadas a esta orden.")
  } else if (!hasLineItems) {
    warnings.push("Las facturas adjuntadas no tienen ítems detallados. Se recomienda agregar ítems para conciliación precisa.")
  }

  const mismatchedItems = items.filter((item) => !item.matched && item.invoicedQty > 0)
  for (const item of mismatchedItems) {
    if (item.difference > 0) {
      warnings.push(`"${item.productName}": cant. OC (${item.ocQuantity}) > cant. facturada (${item.invoicedQty}).`)
    } else {
      warnings.push(`"${item.productName}": cant. facturada (${item.invoicedQty}) > cant. OC (${item.ocQuantity}).`)
    }
  }

  if (uncoveredItems.length > 0) {
    warnings.push(`${uncoveredItems.length} ítem(s) de OC sin factura asociada.`)
  }

  if (hasInvoices && Math.abs(totalInvoiced - totalOC) > 1) {
    warnings.push(`Total facturado (${totalInvoiced.toLocaleString("es-CL")}) difiere del total OC (${totalOC.toLocaleString("es-CL")}).`)
  }

  return {
    hasInvoices,
    totalInvoiced,
    totalOC,
    items,
    uncoveredItems,
    warnings,
  }
}
