"use server"

import { redirect }      from "next/navigation"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { registerReceipt } from "@/lib/services/receiving"
import { receiptSchema, type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { safeActionMessage } from "@/lib/action-error"
import { promises as fs } from "node:fs"
import { nanoid } from "@/lib/id"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { createEmergencyResourceCertificatePath, resolveEmergencyResourceCertificatesDir, resolveStorageFile } from "@/lib/storage/config"
import type { EmergencyServiceCertificate } from "@/lib/services/emergency-resource-service"

const REVALIDATE = "/recepcion"

export async function registerReceiptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Each stage has its own permission: office reception is global, faena reception is scoped.
  const stage = formData.get("stage") === "faena" ? "faena" : "office"
  const requiredPermission = stage === "faena" ? "receiving:register_faena" : "receiving:register_office"

  let session
  try { session = await requirePermission(requiredPermission) }
  catch {
    const label = stage === "faena" ? "recepciones en faena" : "llegadas a oficina"
    return { ok: false, message: `Sin permisos para registrar ${label}` }
  }

  let itemsRaw: unknown[] = []
  try {
    itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]")
  } catch {
    return { ok: false, message: "Error al procesar los ítems", fieldErrors: { items: ["Formato de ítems inválido"] } }
  }

  const parsed = receiptSchema.safeParse({
    purchaseOrderId: formData.get("purchaseOrderId"),
    stage,
    worksiteId:      formData.get("worksiteId"),
    dispatchGuideNo: formData.get("dispatchGuideNo"),
    notes:           formData.get("notes"),
    items:           itemsRaw,
  })

  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    return {
      ok: false,
      message: "Revisa los datos de recepción",
      fieldErrors: {
        ...flattened.fieldErrors,
        items: flattened.fieldErrors.items ?? flattened.formErrors,
      },
    }
  }

  const {
    purchaseOrderId,
    worksiteId,
    dispatchGuideNo,
    notes,
    items,
  } = parsed.data

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, purchaseOrderId),
  })
  if (!order) return { ok: false, message: "OC no encontrada" }
  // Faena reception is scoped to the OC's worksite; office reception is global.
  if (stage === "faena" && !canAccessWorksite(session, order.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta OC" }
  }

  // Una línea cuenta si trae recibido, rechazado o dañado (M-3: rechazo total).
  const nonZeroItems = items.filter(
    (i) => i.quantityReceived + (i.quantityRejected ?? 0) + (i.quantityDamaged ?? 0) > 0,
  )
  if (nonZeroItems.length === 0) {
    return { ok: false, message: "Ingresa al menos una cantidad (recibida, rechazada o dañada)" }
  }

  const storedCertificates: string[] = []
  const itemsWithCertificates: Array<(typeof nonZeroItems)[number] & { certificate?: EmergencyServiceCertificate | null }> = []
  for (const item of nonZeroItems) {
    const persisted = await persistEmergencyCertificate(formData.get(`certificate-${item.purchaseOrderItemId}`))
    if (!persisted.ok) {
      await Promise.allSettled(storedCertificates.map((absolutePath) => fs.unlink(absolutePath)))
      return { ok: false, message: persisted.message }
    }
    if (persisted.absolutePath) storedCertificates.push(persisted.absolutePath)
    itemsWithCertificates.push({ ...item, certificate: persisted.attachment })
  }

  let receiptId: string
  try {
    receiptId = await registerReceipt({
      purchaseOrderId,
      receivedBy:      session.user.id,
      userEmail:       session.user.email ?? undefined,
      stage,
      worksiteId:      worksiteId || null,
      dispatchGuideNo: dispatchGuideNo || null,
      notes:           notes || null,
      items:           itemsWithCertificates,
    }, serviceWorksiteScope(session))

    revalidateOperationalViews([REVALIDATE, "/compras", `/compras/${purchaseOrderId}`, "/bodega"])
  } catch (e) {
    await Promise.allSettled(storedCertificates.map((absolutePath) => fs.unlink(absolutePath)))
    logger.error("[registerReceiptAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al registrar recepción") }
  }
  redirect(`/recepcion/${receiptId}`)
}

async function persistEmergencyCertificate(value: FormDataEntryValue | null): Promise<
  | { ok: true; attachment: EmergencyServiceCertificate | null; absolutePath?: string }
  | { ok: false; message: string }
> {
  if (!(value instanceof File) || value.size === 0) return { ok: true, attachment: null }
  const maxMb = await getPdfMaxSizeMb()
  const maxBytes = maxMb * 1024 * 1024
  if (value.size > maxBytes) return { ok: false, message: `El certificado supera el límite de ${maxMb} MB` }
  const buffer = Buffer.from(await value.arrayBuffer())
  const validation = validateFileBuffer(buffer, value.size, MimeType.PROOF)
  if (validation.error) return { ok: false, message: validation.error }
  const safeName = (value.name || "certificado")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 120) || "certificado"
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const directory = resolveEmergencyResourceCertificatesDir()
  const absolutePath = resolveStorageFile(directory, storageName)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(absolutePath, buffer, { flag: "wx" })
  return {
    ok: true,
    absolutePath,
    attachment: {
      fileName: safeName,
      filePath: createEmergencyResourceCertificatePath(storageName),
      fileSize: value.size,
      mimeType: validation.mimeType,
    },
  }
}
