"use server"

import { promises as fs } from "node:fs"
import path from "node:path"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { registerWorkerEppDelivery, type DeliveryAttachmentInput } from "@/lib/services/deliveries"
import { workerDeliverySchema, type ActionState } from "@/lib/validation/operations"

import { createDeliveryAttachmentPath, resolveDeliveriesDir } from "@/lib/storage/config"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"

function serviceWorksiteScope(session: Awaited<ReturnType<typeof requirePermission>>): string[] | "all" {
  const scope = resolveWorksiteScope(session)
  return scope.mode === "all" ? "all" : scope.ids
}

export async function registerWorkerDeliveryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("deliveries:create") }
  catch { return { ok: false, message: "Sin permisos para registrar entregas" } }

  const parsed = workerDeliverySchema.safeParse({
    worksiteId:           formData.get("worksiteId"),
    workerId:             formData.get("workerId"),
    requestItemId:        formData.get("requestItemId"),
    quantity:             formData.get("quantity"),
    receiverName:         formData.get("receiverName") || null,
    notes:                formData.get("notes"),
    returnProductId:      formData.get("returnProductId"),
    returnProductNameFree: formData.get("returnProductNameFree"),
    returnQuantity:       formData.get("returnQuantity") || null,
    returnReason:         formData.get("returnReason"),
    returnNotes:          formData.get("returnNotes"),
  })

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos de la entrega",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const {
    worksiteId, workerId, requestItemId, quantity, receiverName, notes,
    returnProductId, returnProductNameFree, returnQuantity, returnReason, returnNotes,
  } = parsed.data
  if (!canAccessWorksite(session, worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  const proofResult = await persistProofFile(formData.get("proofFile"))
  if (!proofResult.ok) return { ok: false, message: proofResult.message }

  const sigResult = await persistProofFile(formData.get("signatureFile"))
  if (!sigResult.ok) return { ok: false, message: sigResult.message }

  try {
    await registerWorkerEppDelivery({
      worksiteId,
      workerId,
      requestItemId,
      quantity,
      deliveredBy: session.user.id,
      userEmail: session.user.email ?? undefined,
      receiverName: receiverName?.trim() || null,
      notes: notes || null,
      proofAttachment: proofResult.attachment,
      signatureAttachment: sigResult.attachment,
      returnProductId: returnProductId || null,
      returnProductNameFree: returnProductNameFree || null,
      returnQuantity: returnQuantity || null,
      returnReason: returnReason || null,
      returnNotes: returnNotes || null,
    }, serviceWorksiteScope(session))

    revalidateOperationalViews(["/entregas", "/bodega", "/trazabilidad", "/solicitudes"])
    return { ok: true, message: `Entrega registrada: ${quantity} unidades` }
  } catch (e) {
    if (proofResult.absolutePath) {
      await fs.unlink(proofResult.absolutePath).catch(() => undefined)
    }
    if (sigResult.absolutePath) {
      await fs.unlink(sigResult.absolutePath).catch(() => undefined)
    }
    logger.error("[registerWorkerDeliveryAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar entrega" }
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
