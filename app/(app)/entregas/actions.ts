"use server"

import { promises as fs } from "node:fs"
import path from "node:path"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { registerWorkerStockDelivery, type DeliveryAttachmentInput } from "@/lib/services/deliveries"
import { voidWorkerStockDelivery } from "@/lib/services/deliveries-void"
import { workerStockDeliverySchema, type ActionState } from "@/lib/validation/operations"

import { createDeliveryAttachmentPath, resolveDeliveriesDir } from "@/lib/storage/config"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { safeActionMessage } from "@/lib/action-error"

export async function registerWorkerDeliveryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("deliveries:create") }
  catch { return { ok: false, message: "Sin permisos para registrar entregas" } }

  const rawItems = formData.get("itemsJson")
  let items: unknown = []
  if (typeof rawItems === "string") {
    try { items = JSON.parse(rawItems) }
    catch { items = [] }
  }

  const parsed = workerStockDeliverySchema.safeParse({
    sourceWorksiteId: formData.get("sourceWorksiteId"),
    workerId: formData.get("workerId"),
    deliveredAt: formData.get("deliveredAt") || undefined,
    receiverName: formData.get("receiverName") || null,
    notes: formData.get("notes"),
    items,
  })

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos de la entrega",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { sourceWorksiteId, workerId, deliveredAt, receiverName, notes, items: deliveryItems } = parsed.data
  if (!canAccessWorksite(session, sourceWorksiteId)) {
    return { ok: false, message: "No tienes acceso a la bodega seleccionada" }
  }

  const proofResult = await persistProofFile(formData.get("proofFile"))
  if (!proofResult.ok) return { ok: false, message: proofResult.message }

  try {
    await registerWorkerStockDelivery({
      sourceWorksiteId,
      workerId,
      deliveredAt,
      deliveredBy: session.user.id,
      userEmail: session.user.email ?? undefined,
      receiverName: receiverName?.trim() || null,
      notes: notes || null,
      proofAttachment: proofResult.attachment,
      items: deliveryItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        requestItemId: item.requestItemId || null,
        notes: item.notes || null,
      })),
    }, serviceWorksiteScope(session))

    revalidateOperationalViews(["/entregas", "/bodega", "/trazabilidad", "/solicitudes"])
    return {
      ok: true,
      message: `Entrega registrada: ${deliveryItems.length} ${deliveryItems.length === 1 ? "producto" : "productos"}`,
    }
  } catch (e) {
    if (proofResult.absolutePath) {
      await fs.unlink(proofResult.absolutePath).catch(() => undefined)
    }
    logger.error("[registerWorkerDeliveryAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al registrar entrega") }
  }
}

async function persistProofFile(value: FormDataEntryValue | null): Promise<{
  ok: true
  attachment: DeliveryAttachmentInput | null
  absolutePath?: string
} | {
  ok: false
  message: string
}> {
  if (!(value instanceof File) || value.size === 0) {
    return { ok: true, attachment: null }
  }

  const maxMb = await getPdfMaxSizeMb()
  const maxBytes = maxMb * 1024 * 1024
  if (value.size > maxBytes) {
    return { ok: false, message: `El comprobante supera el límite de ${maxMb} MB` }
  }

  // Read file once, validate magic bytes, then write to disk
  const fileBuf = new Uint8Array(await value.arrayBuffer())
  const validation = validateFileBuffer(fileBuf, value.size, MimeType.PROOF)
  if (validation.error) {
    return { ok: false, message: validation.error }
  }

  const safeName = sanitizeFileName(value.name || "comprobante")
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolveDeliveriesDir()
  const relativePath = createDeliveryAttachmentPath(storageName)
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
    .slice(0, 120) || "comprobante"
}

export async function voidDeliveryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("deliveries:void") }
  catch { return { ok: false, message: "Sin permisos para anular entregas" } }

  const deliveryId = formData.get("deliveryId")
  const reason = formData.get("reason")
  if (typeof deliveryId !== "string" || !deliveryId) {
    return { ok: false, message: "Entrega no indicada" }
  }
  if (typeof reason !== "string" || reason.trim().length < 10) {
    return {
      ok: false,
      message: "Explica por qué se anula (mínimo 10 caracteres)",
      fieldErrors: { reason: ["Mínimo 10 caracteres"] },
    }
  }

  try {
    await voidWorkerStockDelivery({
      deliveryId,
      reason,
      voidedBy: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))

    revalidateOperationalViews(["/entregas", "/bodega", "/trazabilidad", "/solicitudes"])
    return { ok: true, message: "Entrega anulada y stock repuesto" }
  } catch (e) {
    logger.error("[voidDeliveryAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al anular la entrega") }
  }
}
