"use server"

import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { promises as fs } from "node:fs"
import path from "node:path"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderInvoices } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { createPurchaseOrderInvoice, deletePurchaseOrderInvoice } from "@/lib/services/purchasing"
import { nanoid } from "@/lib/id"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { createInvoiceAttachmentPath, resolvePurchaseOrdersDir } from "@/lib/storage/config"
import { invoiceSchema, type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"

import { safeActionMessage as dbErrMsg } from "@/lib/action-error"
import { assertOrderAccess } from "./actions.helpers"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"

// ── File helpers ───────────────────────────────────────────────────────────────

type InvoiceAttachment = {
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
}

async function persistInvoiceFile(value: FormDataEntryValue | null): Promise<
  | { ok: true; attachment: InvoiceAttachment | null; absolutePath?: string }
  | { ok: false; message: string }
> {
  if (!(value instanceof File) || value.size === 0) {
    return { ok: true, attachment: null }
  }

  const maxMb = await getPdfMaxSizeMb()
  const maxBytes = maxMb * 1024 * 1024
  if (value.size > maxBytes) {
    return { ok: false, message: `El archivo supera el límite de ${maxMb} MB` }
  }

  // Read file once, validate magic bytes, then write to disk
  const fileBuf = new Uint8Array(await value.arrayBuffer())
  const validation = validateFileBuffer(fileBuf, value.size, MimeType.INVOICE)
  if (validation.error) {
    return { ok: false, message: validation.error }
  }

  const safeName = sanitizeFileName(value.name || "factura")
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolvePurchaseOrdersDir()
  const relativePath = createInvoiceAttachmentPath(storageName)
  const absolutePath = path.join(storageDir, storageName)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(absolutePath, Buffer.from(fileBuf))

  return {
    ok: true,
    absolutePath,
    attachment: {
      fileName: safeName,
      filePath: relativePath,
      fileSize: value.size,
      mimeType: validation.mimeType,
    },
  }
}

function sanitizeFileName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "factura"
}

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

  try {
    await createPurchaseOrderInvoice({
      purchaseOrderId,
      invoiceNumber,
      amount,
      issueDate: issueDate || null,
      fileName:  fileResult.attachment.fileName,
      filePath:  fileResult.attachment.filePath,
      fileSize:  fileResult.attachment.fileSize,
      mimeType:  fileResult.attachment.mimeType,
      uploadedBy: session.user.id,
      userEmail:  session.user.email ?? undefined,
      items: items.length > 0 ? items : undefined,
    })
    // La cola operacional tiene el pendiente "Adjuntar factura": sin esto el
    // usuario lo resolvía y seguía viéndolo (con su badge) hasta que otra
    // mutación cualquiera revalidara.
    revalidateOperationalViews(["/compras", `/compras/${purchaseOrderId}`])
    return { ok: true, message: `Factura ${invoiceNumber} adjuntada correctamente` }
  } catch (e) {
    if (fileResult.absolutePath) {
      await fs.unlink(fileResult.absolutePath).catch(() => undefined)
    }
    logger.error("[addInvoiceAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al adjuntar factura") }
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
    // Scope de la sesión, no "all": `assertOrderAccess` ya validó el acceso,
    // pero era el único camino de compras que soltaba el cinturón dentro de la
    // transacción — el resto (cancelar, cerrar, borrar, recibir) lo pasa.
    const { filePath } = await deletePurchaseOrderInvoice(invoiceId, session.user.id, serviceWorksiteScope(session), {
      userEmail: session.user.email ?? undefined,
    })

    // Remove the file from disk (best-effort — don't fail if already gone)
    const { resolveInvoiceAttachmentFile } = await import("@/lib/storage/config")
    const absolutePath = resolveInvoiceAttachmentFile(filePath)
    if (absolutePath) {
      await fs.unlink(absolutePath).catch(() => undefined)
    }

    // La cola operacional tiene el pendiente "Adjuntar factura": sin esto el
    // usuario lo resolvía y seguía viéndolo (con su badge) hasta que otra
    // mutación cualquiera revalidara.
    revalidateOperationalViews(["/compras", `/compras/${purchaseOrderId}`])
    return { ok: true, message: "Factura eliminada correctamente" }
  } catch (e) {
    logger.error("[deleteInvoiceAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al eliminar factura") }
  }
}
