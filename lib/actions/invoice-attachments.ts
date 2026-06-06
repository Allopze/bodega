"use server"

import { mkdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { invoiceAttachments, purchaseOrders, purchaseRequests } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { canViewInvoiceAttachments } from "@/lib/auth/invoice-attachments"
import type { ActionState } from "@/lib/validation/masters"

export type InvoiceTargetType = "purchase_request" | "purchase_order"

const STORAGE_DIR = path.join(process.cwd(), "storage", "invoices")
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
])
const MAX_FILE_SIZE = 10 * 1024 * 1024

export async function uploadInvoiceAttachment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("invoice_attachments:manage") }
  catch { return { ok: false, message: "Sin permisos para anexar facturas" } }
  if (!canViewInvoiceAttachments(session)) return { ok: false, message: "Sin permisos para anexar facturas" }

  const targetType = formData.get("targetType") as InvoiceTargetType | null
  const targetId = formData.get("targetId") as string | null
  const invoiceNumber = (formData.get("invoiceNumber") as string | null)?.trim()
  const invoiceDate = formData.get("invoiceDate") as string | null
  const amountRaw = formData.get("amount") as string | null
  const notes = (formData.get("notes") as string | null)?.trim()
  const file = formData.get("file")

  if (targetType !== "purchase_request" && targetType !== "purchase_order") {
    return { ok: false, message: "Destino de factura inválido" }
  }
  if (!targetId) return { ok: false, message: "Destino no especificado" }
  if (!invoiceNumber) return { ok: false, fieldErrors: { invoiceNumber: ["Número de factura requerido"] } }
  if (!invoiceDate) return { ok: false, fieldErrors: { invoiceDate: ["Fecha de factura requerida"] } }
  const amount = Number(amountRaw)
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, fieldErrors: { amount: ["Monto inválido"] } }
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, fieldErrors: { file: ["Selecciona un archivo"] } }
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, fieldErrors: { file: ["El archivo no puede superar 10 MB"] } }
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { ok: false, fieldErrors: { file: ["Solo se aceptan PDF, JPG, PNG o WebP"] } }
  }

  const target = await assertTargetAccess(session, targetType, targetId)
  if (!target.ok) return { ok: false, message: target.message }

  const id = nanoid()
  const safeName = sanitizeFileName(file.name)
  const storageName = `${id}-${safeName}`
  const filePath = path.join("storage", "invoices", storageName)
  const absolutePath = path.join(STORAGE_DIR, storageName)
  const bytes = Buffer.from(await file.arrayBuffer())

  await mkdir(STORAGE_DIR, { recursive: true })
  await writeFile(absolutePath, bytes)

  await db.insert(invoiceAttachments).values({
    id,
    targetType,
    targetId,
    invoiceNumber,
    invoiceDate,
    amount,
    fileName: file.name,
    storageName,
    filePath,
    fileSize: file.size,
    mimeType: file.type,
    notes: notes || null,
    uploadedBy: session.user.id,
  })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "create",
    entityType: "invoice_attachment",
    entityId: id,
    entityCode: invoiceNumber,
    newState: { targetType, targetId, amount, fileName: file.name },
  })

  revalidatePath(pathForTarget(targetType, targetId))
  return { ok: true, message: "Factura anexada" }
}

export async function deleteInvoiceAttachment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("invoice_attachments:manage") }
  catch { return { ok: false, message: "Sin permisos para eliminar facturas anexas" } }
  if (!canViewInvoiceAttachments(session)) return { ok: false, message: "Sin permisos para eliminar facturas anexas" }

  const id = formData.get("id") as string | null
  if (!id) return { ok: false, message: "Factura no especificada" }

  const attachment = await db.query.invoiceAttachments.findFirst({
    where: eq(invoiceAttachments.id, id),
  })
  if (!attachment) return { ok: false, message: "Factura anexa no encontrada" }

  const targetType = attachment.targetType as InvoiceTargetType
  const target = await assertTargetAccess(session, targetType, attachment.targetId)
  if (!target.ok) return { ok: false, message: target.message }

  await db.delete(invoiceAttachments).where(eq(invoiceAttachments.id, id))
  await unlink(path.join(STORAGE_DIR, attachment.storageName)).catch(() => undefined)

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "delete",
    entityType: "invoice_attachment",
    entityId: id,
    entityCode: attachment.invoiceNumber,
    oldState: {
      targetType: attachment.targetType,
      targetId: attachment.targetId,
      amount: attachment.amount,
      fileName: attachment.fileName,
    },
  })

  revalidatePath(pathForTarget(targetType, attachment.targetId))
  return { ok: true, message: "Factura anexa eliminada" }
}

export async function reconcileInvoiceAttachment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("invoice_attachments:manage") }
  catch { return { ok: false, message: "Sin permisos para conciliar facturas" } }

  const id     = formData.get("id") as string | null
  const status = formData.get("status") as "registered" | "observed" | "reconciled" | null
  const notes  = (formData.get("reconciliationNotes") as string | null)?.trim() || null

  if (!id) return { ok: false, message: "Factura no especificada" }
  if (!status || !["registered", "observed", "reconciled"].includes(status)) {
    return { ok: false, message: "Estado de conciliación inválido" }
  }

  const attachment = await db.query.invoiceAttachments.findFirst({
    where: eq(invoiceAttachments.id, id),
  })
  if (!attachment) return { ok: false, message: "Factura anexa no encontrada" }

  const targetType = attachment.targetType as InvoiceTargetType
  const target = await assertTargetAccess(session, targetType, attachment.targetId)
  if (!target.ok) return { ok: false, message: target.message }

  const now = new Date().toISOString()
  await db.update(invoiceAttachments).set({
    status,
    reconciliationNotes: notes,
    reconciledAt:  status === "registered" ? null : now,
    reconciledBy:  status === "registered" ? null : session.user.id,
  }).where(eq(invoiceAttachments.id, id))

  await recordAudit({
    userId:     session.user.id,
    userEmail:  session.user.email ?? undefined,
    action:     "update",
    entityType: "invoice_attachment",
    entityId:   id,
    entityCode: attachment.invoiceNumber,
    oldState:   { status: attachment.status, reconciliationNotes: attachment.reconciliationNotes },
    newState:   { status, reconciliationNotes: notes },
  })

  revalidatePath(pathForTarget(targetType, attachment.targetId))

  const label = status === "reconciled" ? "Factura conciliada" : status === "observed" ? "Factura observada" : "Factura restablecida"
  return { ok: true, message: label }
}

export async function canReadInvoiceAttachment(session: Session, attachmentId: string) {
  if (!canViewInvoiceAttachments(session)) return null
  const attachment = await db.query.invoiceAttachments.findFirst({
    where: eq(invoiceAttachments.id, attachmentId),
  })
  if (!attachment) return null
  const targetType = attachment.targetType as InvoiceTargetType
  const target = await assertTargetAccess(session, targetType, attachment.targetId)
  if (!target.ok) return null
  return attachment
}

async function assertTargetAccess(
  session: Session,
  targetType: InvoiceTargetType,
  targetId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (targetType === "purchase_request") {
    const request = await db.query.purchaseRequests.findFirst({
      where: eq(purchaseRequests.id, targetId),
    })
    if (!request) return { ok: false, message: "Solicitud no encontrada" }
    if (!canAccessWorksite(session, request.worksiteId)) {
      return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
    }
    return { ok: true }
  }

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, targetId),
  })
  if (!order) return { ok: false, message: "Orden de compra no encontrada" }
  if (!canAccessWorksite(session, order.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta orden" }
  }
  return { ok: true }
}

function pathForTarget(targetType: InvoiceTargetType, targetId: string) {
  return targetType === "purchase_request" ? `/solicitudes/${targetId}` : `/compras/${targetId}`
}

function sanitizeFileName(fileName: string) {
  const fallback = "factura"
  const cleaned = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120)
  return cleaned || fallback
}
