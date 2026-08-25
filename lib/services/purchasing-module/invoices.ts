/**
 * Invoice management for purchase orders.
 */

import { and, eq, inArray, isNull, or } from "drizzle-orm"
import { db } from "@/db"
import { dteDocumentItems, dteDocuments, products, purchaseOrders, purchaseOrderInvoices, purchaseOrderInvoiceItems, purchaseOrderItems, supplierProductAliases, suppliers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { cleanRut } from "@/lib/rut"
import { localDateToISO } from "@/lib/sst/date"
import {
  type ReconciledOrderItem,
  type InvoiceReconciliationEvidence,
} from "./invoice-reconciliation"
import { matchInvoiceItemsToPurchaseOrderItems } from "./invoice-item-matching"
import { getPurchaseOrderInvoiceReconciliation, persistPurchaseOrderInvoiceReconciliationTx, reconciliationWarnings } from "./invoice-reconciliation-service"
import { dteInvoiceRejection, normalizeSupplierProductCode, normalizeSupplierProductName } from "./dte-candidates"

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
  /** Evidencia fiscal de origen; sólo el flujo DTE puede poblarla. */
  sourceDteDocumentItemId?: string | null
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
  supplierIdentity?: {
    documentSupplierRut: string | null
    status: "verified" | "unverified"
    source: "dte_xml" | "pdf_text" | "pdf_text_ocr" | "ocr" | "manual"
  }
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
  lineResolutions?: DteInvoiceLineResolution[]
}

export interface DteInvoiceLineResolution {
  dteDocumentItemId: string
  purchaseOrderItemId: string | null
  rememberAlias: boolean
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
    lineResolutions: input.lineResolutions,
  })
}

async function insertPurchaseOrderInvoice(
  input: CreateInvoiceInput,
  worksiteIds: string[] | 'all' = 'all',
  dteAttachment?: {
    dteDocumentId: string
    dteIdentity: DteInvoiceIdentity
    lineResolutions?: DteInvoiceLineResolution[]
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

    if (input.supplierIdentity) {
      const [supplier] = await tx.select({ rut: suppliers.rut })
        .from(suppliers)
        .where(eq(suppliers.id, order.supplierId))
      if (!supplier?.rut) throw new Error("El proveedor de la OC no tiene RUT verificable")
      if (input.supplierIdentity.status === "verified") {
        if (!input.supplierIdentity.documentSupplierRut) throw new Error("La identidad verificada no contiene RUT documental")
        if (cleanRut(input.supplierIdentity.documentSupplierRut) !== cleanRut(supplier.rut)) {
          throw new Error("El RUT de la factura no corresponde al proveedor de esta OC")
        }
      } else if (input.supplierIdentity.documentSupplierRut) {
        throw new Error("Una factura con RUT extraído no puede guardarse como no verificada")
      }
    }

    if (dteAttachment) {
      await validateDteForInvoiceTx(tx, order, input, dteAttachment)
      invoiceItems = dteAttachment.lineResolutions
        ? await applyExplicitDteLineResolutionsTx(
            tx,
            input.purchaseOrderId,
            dteAttachment.dteDocumentId,
            invoiceItems,
            dteAttachment.lineResolutions,
          )
        : await linkDteItemsToOrderTx(tx, input.purchaseOrderId, invoiceItems)
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

    if (dteAttachment?.lineResolutions?.some((resolution) => resolution.rememberAlias)) {
      await persistConfirmedSupplierAliasesTx(
        tx,
        order.supplierId,
        input.uploadedBy,
        dteAttachment.lineResolutions,
      )
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
      documentSupplierRut: dteAttachment?.dteIdentity.supplierRut ?? input.supplierIdentity?.documentSupplierRut ?? null,
      supplierIdentityStatus: dteAttachment ? "verified" : input.supplierIdentity?.status ?? "unknown",
      supplierIdentitySource: dteAttachment ? "dte_xml" : input.supplierIdentity?.source ?? "legacy",
    })

    // Insert invoice items if provided
    if (invoiceItems.length > 0) {
      await tx.insert(purchaseOrderInvoiceItems).values(
        invoiceItems.map((item) => ({
          id:                  nanoid(),
          invoiceId,
          purchaseOrderItemId: item.purchaseOrderItemId ?? null,
          sourceDteDocumentItemId: item.sourceDteDocumentItemId ?? null,
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

    await persistPurchaseOrderInvoiceReconciliationTx(tx, order.id)

    return invoiceId
  })
}

async function applyExplicitDteLineResolutionsTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  purchaseOrderId: string,
  dteDocumentId: string,
  invoiceItems: ReturnType<typeof normalizeInvoiceItems>,
  resolutions: DteInvoiceLineResolution[],
) {
  if (resolutions.length !== invoiceItems.length || resolutions.length === 0) {
    throw new Error("Debes resolver todas las líneas del DTE")
  }
  const resolutionByLine = new Map(resolutions.map((resolution) => [resolution.dteDocumentItemId, resolution]))
  if (resolutionByLine.size !== resolutions.length) throw new Error("Una línea DTE fue resuelta más de una vez")

  const sourceIds = invoiceItems
    .map((item) => item.sourceDteDocumentItemId)
    .filter((id): id is string => Boolean(id))
  if (sourceIds.length !== invoiceItems.length || new Set(sourceIds).size !== sourceIds.length) {
    throw new Error("Las líneas del XML no coinciden con la evidencia persistida")
  }
  const persistedLines = await tx
    .select({ id: dteDocumentItems.id })
    .from(dteDocumentItems)
    .where(and(
      eq(dteDocumentItems.dteDocumentId, dteDocumentId),
      inArray(dteDocumentItems.id, sourceIds),
    ))
  if (persistedLines.length !== sourceIds.length || sourceIds.some((id) => !resolutionByLine.has(id))) {
    throw new Error("Una resolución no pertenece a este DTE")
  }

  const targetIds = resolutions
    .map((resolution) => resolution.purchaseOrderItemId)
    .filter((id): id is string => Boolean(id))
  if (new Set(targetIds).size !== targetIds.length) throw new Error("No puedes asociar dos líneas DTE al mismo ítem de la OC")
  if (targetIds.length > 0) {
    const validTargets = await tx
      .select({ id: purchaseOrderItems.id })
      .from(purchaseOrderItems)
      .where(and(
        eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
        inArray(purchaseOrderItems.id, targetIds),
      ))
    if (validTargets.length !== targetIds.length) throw new Error("Una resolución no pertenece a esta OC")
  }

  return invoiceItems.map((item) => ({
    ...item,
    purchaseOrderItemId: resolutionByLine.get(item.sourceDteDocumentItemId!)!.purchaseOrderItemId,
  }))
}

async function persistConfirmedSupplierAliasesTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  supplierId: string,
  confirmedBy: string,
  resolutions: DteInvoiceLineResolution[],
) {
  const remembered = resolutions.filter(
    (resolution): resolution is DteInvoiceLineResolution & { purchaseOrderItemId: string } =>
      resolution.rememberAlias && Boolean(resolution.purchaseOrderItemId),
  )
  if (remembered.length === 0) return

  const [orderItems, documentLines] = await Promise.all([
    tx.select({ id: purchaseOrderItems.id, productId: purchaseOrderItems.productId })
      .from(purchaseOrderItems)
      .where(inArray(purchaseOrderItems.id, remembered.map((resolution) => resolution.purchaseOrderItemId))),
    tx.select({
      id: dteDocumentItems.id,
      productCode: dteDocumentItems.productCode,
      productName: dteDocumentItems.productName,
      unitOfMeasure: dteDocumentItems.unitOfMeasure,
    }).from(dteDocumentItems)
      .where(inArray(dteDocumentItems.id, remembered.map((resolution) => resolution.dteDocumentItemId))),
  ])
  const productByOrderItem = new Map(orderItems.map((item) => [item.id, item.productId]))
  const lineById = new Map(documentLines.map((line) => [line.id, line]))

  // Los rechazos de acá abortan TODA la factura, así que nombran la línea: el
  // operador pudo marcar varios "Recordar" en el mismo diálogo y sin el nombre
  // del producto no sabe cuál desmarcar para poder seguir.
  for (const resolution of remembered) {
    const productId = productByOrderItem.get(resolution.purchaseOrderItemId)
    const line = lineById.get(resolution.dteDocumentItemId)
    if (!productId || !line) throw new Error("Sólo se pueden recordar correspondencias con productos de catálogo")
    const normalizedCode = normalizeSupplierProductCode(line.productCode) || null
    const normalizedName = normalizeSupplierProductName(line.productName) || null
    if (!normalizedCode && !normalizedName) {
      throw new Error(`La línea "${line.productName}" no contiene un alias utilizable: desmarca "Recordar" en ella`)
    }

    const identityPredicates = [
      normalizedCode ? eq(supplierProductAliases.normalizedCode, normalizedCode) : undefined,
      normalizedName ? eq(supplierProductAliases.normalizedName, normalizedName) : undefined,
    ].filter((predicate): predicate is NonNullable<typeof predicate> => Boolean(predicate))
    const conflicting = await tx.query.supplierProductAliases.findMany({
      where: and(
        eq(supplierProductAliases.supplierId, supplierId),
        identityPredicates.length === 1 ? identityPredicates[0] : or(...identityPredicates),
      ),
      columns: { productId: true },
    })
    if (conflicting.some((alias) => alias.productId !== productId)) {
      throw new Error(`"${line.productName}" ya está confirmado para otro producto: desmarca "Recordar" en esa línea o corrige el alias`)
    }
    if (conflicting.length > 0) continue

    const inserted = await tx.insert(supplierProductAliases).values({
      id: nanoid(),
      supplierId,
      productId,
      supplierProductCode: line.productCode,
      supplierProductName: line.productName,
      normalizedCode,
      normalizedName,
      unitOfMeasure: line.unitOfMeasure,
      confirmedBy,
      sourceDteDocumentItemId: line.id,
    }).onConflictDoNothing().returning({ productId: supplierProductAliases.productId })
    if (inserted.length === 0) {
      const winner = await tx.query.supplierProductAliases.findFirst({
        where: and(
          eq(supplierProductAliases.supplierId, supplierId),
          identityPredicates.length === 1 ? identityPredicates[0] : or(...identityPredicates),
        ),
        columns: { productId: true },
      })
      if (!winner || winner.productId !== productId) {
        throw new Error(`"${line.productName}" fue confirmado para otro producto en paralelo: desmarca "Recordar" en esa línea y vuelve a intentar`)
      }
    }
  }
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

  // Mismo predicado que aplica la acción antes de bajar nada del portal; acá es
  // la autoridad, porque corre con el DTE bloqueado (`FOR UPDATE`).
  const rejection = dteInvoiceRejection(dte, supplier?.rut, localDateToISO(new Date(order.createdAt)))
  if (rejection) throw new Error(rejection)
  // El predicado ya descartó el documento ausente; el compilador no lo deduce
  // de un string de vuelta.
  if (!dte) throw new Error("El DTE o proveedor ya no está disponible")

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

    await persistPurchaseOrderInvoiceReconciliationTx(tx, order.id)

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
  const evidence = await getPurchaseOrderInvoiceReconciliation(orderId)

  const uncoveredItems = evidence.items
    .filter((item) => item.status === "not_covered")
    .map(({ ocItemId, productName, ocQuantity }) => ({ ocItemId, productName, ocQuantity }))

  return {
    ...evidence,
    uncoveredItems,
    warnings: reconciliationWarnings(evidence),
  }
}
