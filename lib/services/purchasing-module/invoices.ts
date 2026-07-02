/**
 * Invoice management for purchase orders.
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderInvoices } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"

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
