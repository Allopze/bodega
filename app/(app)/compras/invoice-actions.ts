"use server"

import { revalidatePath } from "next/cache"
import { promises as fs } from "node:fs"
import path from "node:path"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderInvoices } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { createPurchaseOrderInvoice, deletePurchaseOrderInvoice } from "@/lib/services/purchasing"
import { nanoid } from "@/lib/id"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { createInvoiceAttachmentPath, resolvePurchaseOrdersDir } from "@/lib/storage/config"
import { invoiceSchema, type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
import { assertOrderAccess } from "./actions.helpers"

const ALLOWED_INVOICE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/xml",
  "text/xml",
])

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

  if (!ALLOWED_INVOICE_TYPES.has(value.type)) {
    return { ok: false, message: "La factura debe ser PDF, JPG, PNG o XML" }
  }

  const maxMb = await getPdfMaxSizeMb()
  const maxBytes = maxMb * 1024 * 1024
  if (value.size > maxBytes) {
    return { ok: false, message: `El archivo supera el límite de ${maxMb} MB` }
  }

  const safeName = sanitizeFileName(value.name || "factura")
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolvePurchaseOrdersDir()
  const relativePath = createInvoiceAttachmentPath(storageName)
  const absolutePath = path.join(storageDir, storageName)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(absolutePath, Buffer.from(await value.arrayBuffer()))

  return {
    ok: true,
    absolutePath,
    attachment: {
      fileName: safeName,
      filePath: relativePath,
      fileSize: value.size,
      mimeType: value.type,
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
    })
    revalidatePath("/compras")
    revalidatePath(`/compras/${purchaseOrderId}`)
    return { ok: true, message: `Factura ${invoiceNumber} adjuntada correctamente` }
  } catch (e) {
    if (fileResult.absolutePath) {
      await fs.unlink(fileResult.absolutePath).catch(() => undefined)
    }
    logger.error("[addInvoiceAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al adjuntar factura" }
  }
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
    const { filePath } = await deletePurchaseOrderInvoice(invoiceId, session.user.id, {
      userEmail: session.user.email ?? undefined,
    })

    // Remove the file from disk (best-effort — don't fail if already gone)
    const { resolveInvoiceAttachmentFile } = await import("@/lib/storage/config")
    const absolutePath = resolveInvoiceAttachmentFile(filePath)
    if (absolutePath) {
      await fs.unlink(absolutePath).catch(() => undefined)
    }

    revalidatePath("/compras")
    revalidatePath(`/compras/${purchaseOrderId}`)
    return { ok: true, message: "Factura eliminada correctamente" }
  } catch (e) {
    logger.error("[deleteInvoiceAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al eliminar factura" }
  }
}
