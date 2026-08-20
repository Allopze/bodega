/**
 * Invoice management for purchase orders.
 */

import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments, products, purchaseOrders, purchaseOrderInvoices, purchaseOrderInvoiceItems, purchaseOrderItems, suppliers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { cleanRut } from "@/lib/rut"
import { localDateToISO } from "@/lib/sst/date"
import {
  reconcileInvoiceEvidence,
  type ReconciledOrderItem,
  type InvoiceReconciliationEvidence,
} from "./invoice-reconciliation"
import { matchInvoiceItemsToPurchaseOrderItems } from "./invoice-item-matching"

/* ── Purchase Order Invoices ─────────────────────────────────────────────────── */

const INVOICE_ALLOWED_STATUSES = new Set([
  "sent",
  "partially_office_received", "office_received",
  "partially_received", "received", "closed",
])

// Quitar la factura se permite además sobre una OC anulada. Una OC en `sent`
// admite factura Y admite anulación, así que la secuencia normal —se adjunta la
// factura, se anula la OC— dejaba el DTE colgado de una compra muerta: ésta es
// la única ruta de desvinculación del repo, y bloquearla acá era un callejón
// sin salida que sólo se abría con SQL manual.
const INVOICE_DELETABLE_STATUSES = new Set([...INVOICE_ALLOWED_STATUSES, "cancelled"])

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
  /** Manual uploads keep their line-total guard; DTE uses MntTotal as authority. */
  amountAuthority?: "line_items" | "document_header"
}

export interface DteInvoiceIdentity {
  tipoDte: string | null
  invoiceNumber: string
  issueDate: string | null
  supplierRut: string | null
  totalAmount: number
}

export interface CreateInvoiceFromDteInput extends CreateInvoiceInput {
  dteDocumentId: string
  dteIdentity: DteInvoiceIdentity
  amountAuthority: "document_header"
  items: CreateInvoiceItemInput[]
}

export interface DeleteInvoiceResult {
  filePath: string
}

export async function createPurchaseOrderInvoice(
  input: CreateInvoiceInput,
  worksiteIds: string[] | 'all' = 'all',
): Promise<string> {
  const invoiceId = await insertPurchaseOrderInvoice(input, worksiteIds)

  // Cruce con el DTE que ya llegó del portal. Va FUERA de la transacción y con
  // su propio try/catch a propósito: la factura ya está guardada y el vínculo
  // es un enriquecimiento. Un portal caído o un dato raro no puede voltear el
  // registro que la persona acaba de hacer.
  //
  // Sin esto el cruce sólo ocurría durante la sincronización, así que la
  // secuencia normal —el proveedor emite, el DTE llega, y días después Compras
  // registra la factura— no se vinculaba nunca.
  try {
    const { matchInvoiceToDteDocument } = await import("@/lib/services/dte-portal/reconciliation")
    await matchInvoiceToDteDocument(invoiceId)
  } catch {
    // The invoice is already durable. Reconciliation is best-effort, and its
    // failure must not serialize a database/provider error into process logs.
    logger.error("[invoices] conciliación DTE no disponible", {
      code: "DTE_RECONCILIATION_FAILED",
      invoiceId,
    })
  }

  return invoiceId
}

/**
 * Registra una factura creada desde un DTE ya sincronizado. A diferencia de la
 * conciliación best-effort de una carga manual, insertar la factura y marcar
 * el DTE ocurren en la misma transacción: un documento tributario no queda
 * disponible para dos órdenes ni para combustible a la vez.
 */
export async function createPurchaseOrderInvoiceFromDte(
  input: CreateInvoiceFromDteInput,
  worksiteIds: string[] | "all" = "all",
): Promise<string> {
  return insertPurchaseOrderInvoice(input, worksiteIds, {
    dteDocumentId: input.dteDocumentId,
    dteIdentity: input.dteIdentity,
  })
}

async function insertPurchaseOrderInvoice(
  input: CreateInvoiceInput,
  worksiteIds: string[] | 'all' = 'all',
  dteAttachment?: {
    dteDocumentId: string
    dteIdentity: DteInvoiceIdentity
  },
): Promise<string> {
  return await db.transaction(async (tx) => {
    if (!Number.isFinite(input.amount) || input.amount < 0) {
      throw new Error("Monto de factura inválido")
    }
    let invoiceItems = normalizeInvoiceItems(
      input.items,
      input.amountAuthority === "document_header",
    )
    // Lock de la OC: sin él, una anulación concurrente commiteaba entre esta
    // lectura y el insert, y la factura quedaba adjunta a una OC ya `cancelled`.
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        status: purchaseOrders.status,
        code: purchaseOrders.code,
        worksiteId: purchaseOrders.worksiteId,
        supplierId: purchaseOrders.supplierId,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, input.purchaseOrderId))
      .for("update")
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

    if (dteAttachment) {
      await validateDteForInvoiceTx(tx, order, input, dteAttachment)
      invoiceItems = await linkDteItemsToOrderTx(tx, input.purchaseOrderId, invoiceItems)
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

    // Una carga manual recalcula desde líneas para no confiar en el navegador.
    // Un DTE validado conserva MntTotal: las líneas suelen ser netas y pueden
    // incluir descuentos/exentos que no suman el total tributario.
    const totalAmount = input.amountAuthority === "document_header"
      ? input.amount
      : invoiceItems.length > 0
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

    if (dteAttachment) {
      const linked = await tx.update(dteDocuments)
        .set({ purchaseOrderInvoiceId: invoiceId })
        .where(and(
          eq(dteDocuments.id, dteAttachment.dteDocumentId),
          isNull(dteDocuments.purchaseOrderInvoiceId),
          isNull(dteDocuments.fuelLoadId),
        ))
        .returning({ id: dteDocuments.id })
      if (linked.length !== 1) {
        throw new Error("Este DTE ya fue usado por otra operación")
      }
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
        dteDocumentId: dteAttachment?.dteDocumentId ?? null,
      },
    }, tx)

    return invoiceId
  })
}

function normalizeInvoiceItems(
  items: CreateInvoiceItemInput[] | undefined,
  preserveDocumentSubtotal = false,
) {
  return (items ?? []).map((item, index) => {
    if (!item.productName.trim()) throw new Error(`La línea ${index + 1} no tiene descripción`)
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error(`Cantidad inválida en la línea ${index + 1}`)
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error(`Precio inválido en la línea ${index + 1}`)

    if (preserveDocumentSubtotal && (!Number.isFinite(item.subtotal) || item.subtotal < 0)) {
      throw new Error(`Monto inválido en la línea ${index + 1}`)
    }

    return {
      ...item,
      productName: item.productName.trim(),
      productCode: item.productCode?.trim() || null,
      unitOfMeasure: item.unitOfMeasure?.trim() || null,
      // Las cargas manuales ignoran el subtotal del navegador. El flujo DTE
      // llega desde XML validado y conserva MontoItem como evidencia fiscal.
      subtotal: preserveDocumentSubtotal
        ? roundMoney(item.subtotal)
        : roundMoney(item.quantity * item.unitPrice),
    }
  })
}

async function validateDteForInvoiceTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  order: {
    id: string
    supplierId: string
    createdAt: string
  },
  input: CreateInvoiceInput,
  attachment: { dteDocumentId: string; dteIdentity: DteInvoiceIdentity },
): Promise<void> {
  const [[supplier], [dte]] = await Promise.all([
    tx
      .select({ rut: suppliers.rut })
      .from(suppliers)
      .where(eq(suppliers.id, order.supplierId)),
    tx
      .select({
        id: dteDocuments.id,
        tipoDte: dteDocuments.tipoDte,
        folio: dteDocuments.folio,
        rutEmisor: dteDocuments.rutEmisor,
        fechaEmision: dteDocuments.fechaEmision,
        montoTotal: dteDocuments.montoTotal,
        purchaseOrderInvoiceId: dteDocuments.purchaseOrderInvoiceId,
        fuelLoadId: dteDocuments.fuelLoadId,
      })
      .from(dteDocuments)
      .where(eq(dteDocuments.id, attachment.dteDocumentId))
      .for("update"),
  ])

  if (!dte || !supplier?.rut) throw new Error("El DTE o proveedor ya no está disponible")
  if (!['33', '34'].includes(dte.tipoDte)) throw new Error("Este tipo de DTE no puede registrarse como factura de OC")
  if (dte.purchaseOrderInvoiceId || dte.fuelLoadId) throw new Error("Este DTE ya fue usado por otra operación")
  if (cleanRut(dte.rutEmisor) !== cleanRut(supplier.rut)) {
    throw new Error("El emisor del DTE no corresponde al proveedor de esta OC")
  }
  if (dte.fechaEmision < localDateToISO(new Date(order.createdAt))) {
    throw new Error("El DTE fue emitido antes de crear esta orden")
  }

  const xmlFolio = parseDteFolio(attachment.dteIdentity.invoiceNumber)
  const hasSameIdentity = (
    attachment.dteIdentity.tipoDte === dte.tipoDte
    && xmlFolio === dte.folio
    && attachment.dteIdentity.issueDate === dte.fechaEmision
    && cleanRut(attachment.dteIdentity.supplierRut ?? "") === cleanRut(dte.rutEmisor)
    && Math.abs(attachment.dteIdentity.totalAmount - dte.montoTotal) <= 1
    && Math.abs(input.amount - attachment.dteIdentity.totalAmount) <= 1
  )
  if (!hasSameIdentity) {
    throw new Error("El XML descargado no corresponde al DTE seleccionado")
  }
}

async function linkDteItemsToOrderTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  purchaseOrderId: string,
  invoiceItems: ReturnType<typeof normalizeInvoiceItems>,
) {
  const orderItems = await tx
    .select({
      id: purchaseOrderItems.id,
      productNameFree: purchaseOrderItems.productNameFree,
      productName: products.name,
      productCode: products.sku,
      unitOfMeasure: purchaseOrderItems.unitOfMeasure,
    })
    .from(purchaseOrderItems)
    .leftJoin(products, eq(purchaseOrderItems.productId, products.id))
    .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId))

  const matches = matchInvoiceItemsToPurchaseOrderItems(
    invoiceItems,
    orderItems.map((item) => ({
      id: item.id,
      productName: item.productNameFree ?? item.productName ?? item.id,
      productCode: item.productCode ?? null,
      unitOfMeasure: item.unitOfMeasure,
    })),
  )
  return matches.map((match) => ({
    ...match.item,
    purchaseOrderItemId: match.ocItemId,
  }))
}

function parseDteFolio(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const folio = Number(normalized)
  return Number.isSafeInteger(folio) ? folio : null
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

    const [order] = await tx
      .select({ id: purchaseOrders.id, code: purchaseOrders.code, worksiteId: purchaseOrders.worksiteId, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, invoice.purchaseOrderId))
      .for("update")
    if (!order) throw new Error("Orden de compra no encontrada")
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    // Se puede quitar una factura exactamente donde se podría haber adjuntado:
    // antes no había ninguna restricción de estado y sólo el permiso frenaba el
    // borrado sobre una OC anulada. `closed` sigue permitido a propósito — una OC
    // se auto-cierra al recibirse completa, así que bloquearlo dejaría una
    // factura equivocada pegada para siempre y sin forma de corregirla.
    if (!INVOICE_DELETABLE_STATUSES.has(order.status)) {
      throw new Error(`No se puede eliminar la factura de una OC en estado '${order.status}'`)
    }

    // La FK DTE → factura es NO ACTION por trazabilidad. Se desvincula dentro
    // de la misma transacción antes de borrar, para que una factura creada
    // desde DTE pueda corregirse sin dejar evidencia colgada.
    await tx.update(dteDocuments)
      .set({ purchaseOrderInvoiceId: null })
      .where(eq(dteDocuments.purchaseOrderInvoiceId, invoiceId))

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

export type InvoiceReconciliationItem = ReconciledOrderItem

export interface InvoiceReconciliationResult extends InvoiceReconciliationEvidence {
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

  const evidence = reconcileInvoiceEvidence({
    totalOC: order?.totalAmount ?? 0,
    orderItems: ocItems.map((item) => ({
      id: item.id,
      productName: item.productNameFree ?? item.productId ?? "Ítem",
      quantity: item.quantity,
    })),
    invoices,
  })

  const uncoveredItems = evidence.items
    .filter((item) => item.status === "not_covered")
    .map(({ ocItemId, productName, ocQuantity }) => ({ ocItemId, productName, ocQuantity }))

  const warnings: string[] = []
  if (!evidence.hasInvoices) {
    warnings.push("No hay facturas adjuntadas a esta orden.")
  } else if (evidence.lines.status === "not_evaluable") {
    warnings.push("Las facturas adjuntadas no tienen líneas asociadas; la conciliación por ítem no es evaluable.")
  } else if (evidence.lines.unlinkedLineCount > 0) {
    warnings.push(`${evidence.lines.unlinkedLineCount} línea(s) de factura no están vinculadas a un ítem de la OC.`)
  }

  const mismatchedItems = evidence.items.filter((item) => item.status === "partial" || item.status === "over_invoiced")
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

  if (evidence.money.status === "mismatch") {
    warnings.push(`Total facturado (${evidence.totalInvoiced.toLocaleString("es-CL")}) difiere del total OC (${evidence.totalOC.toLocaleString("es-CL")}).`)
  }

  return {
    ...evidence,
    uncoveredItems,
    warnings,
  }
}
