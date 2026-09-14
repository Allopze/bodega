"use server"

import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderInvoiceReceipts, purchaseOrderInvoices } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { createPurchaseOrderInvoice, deletePurchaseOrderInvoice, setPurchaseOrderInvoiceReceipts } from "@/lib/services/purchasing"
import { invoiceSchema, type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"

import { safeActionMessage as dbErrMsg } from "@/lib/action-error"
import { assertOrderAccess } from "./actions.helpers"
import { persistInvoiceFile, removeInvoiceAttachment } from "./invoice-attachments"
import { extractInvoiceData } from "@/lib/services/purchasing-module/invoice-extractor"

// ── Add Invoice ───────────────────────────────────────────────────────────────

export async function addInvoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:send_order") }
  catch { return { ok: false, message: "Sin permisos para adjuntar facturas" } }

  const parsed = invoiceSchema.safeParse({
    purchaseOrderId: formData.get("purchaseOrderId"),
    invoiceNumber:   formData.get("invoiceNumber"),
    amount:          formData.get("amount"),
    issueDate:       formData.get("issueDate"),
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos de la factura",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { purchaseOrderId, invoiceNumber, amount, issueDate } = parsed.data
  const receiptIds = formData.getAll("receiptId")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)

  const accessError = await assertOrderAccess(session, purchaseOrderId)
  if (accessError) return accessError

  // Validate every submitted line before persisting the attachment. Never
  // silently discard a malformed or unresolved OCR line: that breaks the
  // audit trail and can make an invoice appear reconciled when it is not.
  const itemCount = Number(formData.get("itemCount") ?? 0)
  if (!Number.isInteger(itemCount) || itemCount < 0 || itemCount > 100) {
    return { ok: false, message: "La cantidad de líneas de factura no es válida" }
  }

  const items: Array<{
    purchaseOrderItemId?: string | null
    productName: string
    productCode?: string | null
    unitOfMeasure?: string | null
    quantity: number
    unitPrice: number
    subtotal: number
  }> = []

  for (let i = 0; i < itemCount; i++) {
    const ocItemId = formData.get(`item_ocItemId_${i}`) as string | null
    const productName = formData.get(`item_productName_${i}`) as string | null
    const productCode = formData.get(`item_productCode_${i}`) as string | null
    const unitOfMeasure = formData.get(`item_unitOfMeasure_${i}`) as string | null
    const resolution = formData.get(`item_resolution_${i}`)
    const quantity = Number(formData.get(`item_qty_${i}`))
    const unitPrice = Number(formData.get(`item_price_${i}`))

    if (!productName?.trim()) {
      return { ok: false, message: `La línea ${i + 1} no tiene descripción de documento` }
    }
    if (resolution !== "matched" && resolution !== "unlinked") {
      return { ok: false, message: `Resuelve la asociación de la línea ${i + 1} antes de adjuntar la factura` }
    }
    if (resolution === "matched" && !ocItemId) {
      return { ok: false, message: `La línea ${i + 1} debe indicar el ítem de OC asociado` }
    }
    if (resolution === "unlinked" && ocItemId) {
      return { ok: false, message: `La línea ${i + 1} tiene una asociación inconsistente` }
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return { ok: false, message: `Cantidad o precio inválido en la línea ${i + 1}` }
    }

    items.push({
      purchaseOrderItemId: ocItemId || null,
      productName: productName.trim(),
      productCode: productCode?.trim() || null,
      unitOfMeasure: unitOfMeasure?.trim() || null,
      quantity,
      unitPrice,
      // The client preview is not a financial authority.
      subtotal: roundMoney(quantity * unitPrice),
    })
  }

  const fileResult = await persistInvoiceFile(formData.get("file"))
  if (!fileResult.ok) return { ok: false, message: fileResult.message }

  if (!fileResult.attachment) {
    return { ok: false, message: "El archivo de la factura es obligatorio" }
  }

  let extracted: Awaited<ReturnType<typeof extractInvoiceData>>
  try {
    extracted = await extractInvoiceData(
      fileResult.attachment.verifiedBuffer,
      fileResult.attachment.attachment.mimeType,
      fileResult.attachment.attachment.fileName,
    )
  } catch {
    await removeInvoiceAttachment(fileResult.attachment.absolutePath)
    return { ok: false, message: "No se pudo verificar la identidad del proveedor desde el archivo" }
  }
  const documentSupplierRut = extracted.data?.supplierRut?.trim() || null
  const supplierIdentityStatus = documentSupplierRut ? "verified" as const : "unverified" as const
  if (!documentSupplierRut && formData.get("confirmUnverifiedSupplier") !== "on") {
    await removeInvoiceAttachment(fileResult.attachment.absolutePath)
    return {
      ok: false,
      message: "No se pudo extraer el RUT del proveedor. Confirma explícitamente que la factura quedará en revisión.",
    }
  }
  const supplierIdentitySource = extracted.method === "dte_xml"
    ? "dte_xml" as const
    : extracted.method === "pdf_text"
      ? "pdf_text" as const
      : extracted.method === "pdf_text_ocr"
        ? "pdf_text_ocr" as const
        : extracted.method === "ocr"
          ? "ocr" as const
        : "manual" as const
  const extractedDocumentTotal = extracted.data?.totalAmount
  const hasExtractedDocumentTotal = typeof extractedDocumentTotal === "number"
    && Number.isFinite(extractedDocumentTotal)
    && extractedDocumentTotal >= 0

  try {
    await createPurchaseOrderInvoice({
      purchaseOrderId,
      invoiceNumber,
      // PDF/OCR/DTE extraction reads the document header total, which may be
      // gross while its detail lines are net. The service still ignores the
      // browser preview for line subtotals, but the extracted header is the
      // document authority when it is available.
      amount: hasExtractedDocumentTotal ? extractedDocumentTotal : amount,
      amountAuthority: hasExtractedDocumentTotal ? "document_header" : "line_items",
      issueDate: issueDate || null,
      fileName:  fileResult.attachment.attachment.fileName,
      filePath:  fileResult.attachment.attachment.filePath,
      fileSize:  fileResult.attachment.attachment.fileSize,
      mimeType:  fileResult.attachment.attachment.mimeType,
      uploadedBy: session.user.id,
      userEmail:  session.user.email ?? undefined,
      items: items.length > 0 ? items : undefined,
      receiptIds,
      supplierIdentity: {
        documentSupplierRut,
        status: supplierIdentityStatus,
        source: supplierIdentitySource,
      },
    })
    // La cola operacional tiene el pendiente "Adjuntar factura": sin esto el
    // usuario lo resolvía y seguía viéndolo (con su badge) hasta que otra
    // mutación cualquiera revalidara.
    revalidateOperationalViews([
      "/compras",
      `/compras/${purchaseOrderId}`,
      ...(receiptIds.length > 0
        ? ["/recepcion", ...receiptIds.map((receiptId) => `/recepcion/${receiptId}`)]
        : []),
    ])
    return { ok: true, message: `Factura ${invoiceNumber} adjuntada correctamente` }
  } catch (e) {
    await removeInvoiceAttachment(fileResult.attachment.absolutePath)
    logger.error("[addInvoiceAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al adjuntar factura") }
  }
}

// ── Associate supplier receipts ─────────────────────────────────────────────

export async function setInvoiceReceiptsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:send_order") }
  catch { return { ok: false, message: "Sin permisos para asociar recepciones" } }

  const invoiceId = formData.get("invoiceId")
  const purchaseOrderId = formData.get("purchaseOrderId")
  if (typeof invoiceId !== "string" || !invoiceId || typeof purchaseOrderId !== "string" || !purchaseOrderId) {
    return { ok: false, message: "Factura u orden no especificada" }
  }
  const accessError = await assertOrderAccess(session, purchaseOrderId)
  if (accessError) return accessError

  try {
    const previousReceiptIds = await db
      .select({ receiptId: purchaseOrderInvoiceReceipts.receiptId })
      .from(purchaseOrderInvoiceReceipts)
      .where(eq(purchaseOrderInvoiceReceipts.invoiceId, invoiceId))
    const receiptIds = await setPurchaseOrderInvoiceReceipts({
      invoiceId,
      purchaseOrderId,
      receiptIds: formData.getAll("receiptId").filter((value): value is string => typeof value === "string"),
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      worksiteScope: serviceWorksiteScope(session),
    })
    const affectedReceiptIds = [...new Set([
      ...previousReceiptIds.map((link) => link.receiptId),
      ...receiptIds,
    ])]
    revalidateOperationalViews([
      "/compras",
      `/compras/${purchaseOrderId}`,
      ...(affectedReceiptIds.length > 0
        ? ["/recepcion", ...affectedReceiptIds.map((receiptId) => `/recepcion/${receiptId}`)]
        : []),
    ])
    return {
      ok: true,
      message: receiptIds.length === 0
        ? "Factura guardada sin recepciones asociadas"
        : `${receiptIds.length} recepción(es) asociada(s) correctamente`,
    }
  } catch (e) {
    logger.error("[setInvoiceReceiptsAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al asociar recepciones") }
  }
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// ── Delete Invoice ─────────────────────────────────────────────────────────────

export async function deleteInvoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:send_order") }
  catch { return { ok: false, message: "Sin permisos para eliminar facturas" } }

  const invoiceId = formData.get("invoiceId") as string | null
  const purchaseOrderId = formData.get("purchaseOrderId") as string | null
  const reason = String(formData.get("reason") ?? "")

  if (!invoiceId) return { ok: false, message: "Factura no especificada" }
  if (!purchaseOrderId) return { ok: false, message: "Orden no especificada" }

  // Verify order access before deletion
  const accessError = await assertOrderAccess(session, purchaseOrderId)
  if (accessError) return accessError

  // Verify invoice belongs to this order
  const invoice = await db.query.purchaseOrderInvoices.findFirst({
    where: eq(purchaseOrderInvoices.id, invoiceId),
    columns: { purchaseOrderId: true },
  })
  if (!invoice || invoice.purchaseOrderId !== purchaseOrderId) {
    return { ok: false, message: "Factura no encontrada en esta orden" }
  }

  try {
    const previousReceiptIds = await db
      .select({ receiptId: purchaseOrderInvoiceReceipts.receiptId })
      .from(purchaseOrderInvoiceReceipts)
      .where(eq(purchaseOrderInvoiceReceipts.invoiceId, invoiceId))
    // Scope de la sesión, no "all": `assertOrderAccess` ya validó el acceso,
    // pero era el único camino de compras que soltaba el cinturón dentro de la
    // transacción — el resto (cancelar, cerrar, borrar, recibir) lo pasa.
    await deletePurchaseOrderInvoice(invoiceId, session.user.id, serviceWorksiteScope(session), {
      userEmail: session.user.email ?? undefined,
      reason,
    })

    /*
     * FAC-002 (auditoría 2026-09-14), patrón P5: aquí se borraba el archivo del
     * disco después del commit. Ya no: el PDF es el respaldo tributario, y la
     * fila anulada lo sigue apuntando para que pueda descargarse en una
     * revisión o una fiscalización.
     */

    // La cola operacional tiene el pendiente "Adjuntar factura": sin esto el
    // usuario lo resolvía y seguía viéndolo (con su badge) hasta que otra
    // mutación cualquiera revalidara.
    revalidateOperationalViews([
      "/compras",
      `/compras/${purchaseOrderId}`,
      ...(previousReceiptIds.length > 0
        ? ["/recepcion", ...previousReceiptIds.map(({ receiptId }) => `/recepcion/${receiptId}`)]
        : []),
    ])
    return { ok: true, message: "Factura anulada. El documento se conserva como respaldo." }
  } catch (e) {
    logger.error("[deleteInvoiceAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al anular la factura") }
  }
}
