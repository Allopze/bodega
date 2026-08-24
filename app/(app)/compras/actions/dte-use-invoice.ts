"use server"

import { requirePermission } from "@/lib/auth/can"
import { db } from "@/db"
import { dteDocumentItems } from "@/db/schema"
import { eq } from "drizzle-orm"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { createPurchaseOrderInvoiceFromDte } from "@/lib/services/purchasing"
import { getDteDocumentPdf } from "@/lib/services/dte-portal/purchase-document-pdf"
import { logger } from "@/lib/logger"
import { assertOrderAccess } from "../actions.helpers"
import { downloadDteDocumentXml } from "./dte-download-xml"
import { persistInvoicePdf, removeInvoiceAttachment } from "../invoice-attachments"
import { enrichDteDocumentLines } from "@/lib/services/dte-portal/purchase-document-xml"

export interface UseDteAsInvoiceInput {
  purchaseOrderId: string
  dteDocumentId: string
  lineResolutions?: Array<{
    dteDocumentItemId: string
    purchaseOrderItemId: string | null
    rememberAlias: boolean
  }>
}

/**
 * Convierte un candidato DTE en una factura de OC con su PDF propio. Los datos
 * del cliente sólo eligen ids; XML, PDF, proveedor, monto y líneas se vuelven a
 * obtener en servidor y el vínculo final se protege en la transacción del
 * servicio de compras.
 */
export async function attachDteAsInvoice(
  input: UseDteAsInvoiceInput,
): Promise<{ ok: boolean; message: string }> {
  let session
  try {
    session = await requirePermission("purchasing:send_order")
  } catch {
    return { ok: false, message: "Sin permisos para adjuntar facturas" }
  }

  if (!isOpaqueId(input.purchaseOrderId) || !isOpaqueId(input.dteDocumentId)) {
    return { ok: false, message: "No se pudo adjuntar este DTE" }
  }
  if (input.lineResolutions && (
    input.lineResolutions.length === 0
    || input.lineResolutions.length > 100
    || input.lineResolutions.some((resolution) =>
      !isDteLineId(resolution.dteDocumentItemId)
      || (resolution.purchaseOrderItemId !== null && !isOpaqueId(resolution.purchaseOrderItemId))
      || typeof resolution.rememberAlias !== "boolean"
    )
  )) {
    return { ok: false, message: "Las resoluciones de líneas no son válidas" }
  }
  let accessError: Awaited<ReturnType<typeof assertOrderAccess>>
  try {
    accessError = await assertOrderAccess(session, input.purchaseOrderId)
  } catch {
    logger.error("[attachDteAsInvoice] access check failed", {
      code: "DTE_INVOICE_ACCESS_CHECK_FAILED",
      purchaseOrderId: input.purchaseOrderId,
      dteDocumentId: input.dteDocumentId,
    })
    return { ok: false, message: "No se pudo acceder a la orden" }
  }
  if (accessError) return { ok: false, message: accessError.message ?? "No se pudo acceder a la orden" }

  let xml: Awaited<ReturnType<typeof downloadDteDocumentXml>>
  try {
    xml = await downloadDteDocumentXml(input.dteDocumentId)
  } catch {
    logger.error("[attachDteAsInvoice] XML retrieval failed", {
      code: "DTE_INVOICE_XML_RETRIEVAL_FAILED",
      purchaseOrderId: input.purchaseOrderId,
      dteDocumentId: input.dteDocumentId,
    })
    return { ok: false, message: "No se pudo verificar el XML del DTE" }
  }
  if (!xml.ok || !xml.detail.tipoDte || !xml.detail.issueDate || !xml.detail.supplierRut) {
    return { ok: false, message: "No se pudo verificar el XML del DTE" }
  }

  let persistedLines = await db.query.dteDocumentItems.findMany({
    where: eq(dteDocumentItems.dteDocumentId, input.dteDocumentId),
  })
  if (persistedLines.length === 0) {
    const enrichment = await enrichDteDocumentLines(input.dteDocumentId)
    if (!enrichment.ok) return { ok: false, message: "No se pudieron verificar las líneas del DTE" }
    persistedLines = await db.query.dteDocumentItems.findMany({
      where: eq(dteDocumentItems.dteDocumentId, input.dteDocumentId),
    })
  }
  const persistedByLine = new Map(persistedLines.map((line) => [line.lineNumber, line]))

  let pdf
  try {
    pdf = await getDteDocumentPdf(input.dteDocumentId)
  } catch {
    return { ok: false, message: "No se pudo obtener el PDF del DTE" }
  }

  let persisted
  try {
    persisted = await persistInvoicePdf(pdf.buffer, pdf.fileName)
  } catch {
    return { ok: false, message: "No se pudo adjuntar el PDF del DTE" }
  }

  try {
    await createPurchaseOrderInvoiceFromDte({
      purchaseOrderId: input.purchaseOrderId,
      dteDocumentId: input.dteDocumentId,
      invoiceNumber: xml.detail.invoiceNumber,
      amount: xml.detail.totalAmount,
      amountAuthority: "document_header",
      issueDate: xml.detail.issueDate,
      fileName: persisted.attachment.fileName,
      filePath: persisted.attachment.filePath,
      fileSize: persisted.attachment.fileSize,
      mimeType: persisted.attachment.mimeType,
      uploadedBy: session.user.id,
      userEmail: session.user.email ?? undefined,
      dteIdentity: {
        tipoDte: xml.detail.tipoDte,
        invoiceNumber: xml.detail.invoiceNumber,
        issueDate: xml.detail.issueDate,
        supplierRut: xml.detail.supplierRut,
        totalAmount: xml.detail.totalAmount,
      },
      lineResolutions: input.lineResolutions,
      // Se preservan todas las líneas del XML. El servicio decide bajo lock qué
      // asociación es única; las ambiguas o incompatibles quedan sin vínculo.
      items: xml.detail.items.map((item) => ({
        sourceDteDocumentItemId: persistedByLine.get(item.lineNumber)?.id ?? null,
        productName: item.productName,
        productCode: item.productCode,
        unitOfMeasure: item.unitOfMeasure,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.amount,
      })),
    }, serviceWorksiteScope(session))
  } catch {
    await removeInvoiceAttachment(persisted.absolutePath)
    logger.error("[attachDteAsInvoice] attach failed", {
      code: "DTE_INVOICE_ATTACH_FAILED",
      purchaseOrderId: input.purchaseOrderId,
      dteDocumentId: input.dteDocumentId,
    })
    return { ok: false, message: "No se pudo adjuntar este DTE" }
  }

  revalidateOperationalViews(["/compras", `/compras/${input.purchaseOrderId}`])
  return { ok: true, message: `Factura ${xml.detail.invoiceNumber} adjuntada correctamente` }
}

function isOpaqueId(value: string): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function isDteLineId(value: string): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_:-]{1,256}$/.test(value)
}
