"use server"

import { revalidatePath } from "next/cache"
import { promises as fs } from "node:fs"
import path from "node:path"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { uploadFleetDocument, deleteFleetDocument } from "@/lib/services/fleet"
import { createFleetDocumentPath, resolveFleetDir } from "@/lib/storage/config"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import type { ActionState } from "@/lib/validation/operations"
import { fleetDocumentMetadataSchema } from "@/lib/validation/fleet-documents"

export async function uploadFleetDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("flota:manage_documents") }
  catch { return { ok: false, message: "Sin permisos para subir documentos" } }

  // Tipo y vencimiento entraban crudos: cualquier string se guardaba como tipo
  // documental y una fecha inexistente quedaba en la columna que alimenta las
  // alertas de vencimiento.
  // `formData.get` devuelve `null` cuando el campo no viaja; se normaliza a ""
  // para que el mensaje sea el del esquema y no el genérico de Zod en inglés.
  const parsed = fleetDocumentMetadataSchema.safeParse({
    vehicleId: (formData.get("vehicleId") as string) ?? "",
    documentType: (formData.get("documentType") as string) ?? "",
    expiresAt: (formData.get("expiresAt") as string) || null,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos del documento" }
  }
  const { vehicleId, documentType, expiresAt } = parsed.data
  const file = formData.get("file") as File | null

  if (!file || file.size === 0) return { ok: false, message: "Archivo requerido" }

  const MAX_MB = 20
  if (file.size > MAX_MB * 1024 * 1024) {
    return { ok: false, message: `El archivo supera el límite de ${MAX_MB} MB` }
  }

  const fileBuf = new Uint8Array(await file.arrayBuffer())
  const validation = validateFileBuffer(fileBuf, file.size, MimeType.PROOF)
  if (validation.error) {
    return { ok: false, message: validation.error }
  }

  const safeName = (file.name || "documento")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "documento"
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolveFleetDir()
  const relativePath = createFleetDocumentPath(storageName)
  const absolutePath = path.join(storageDir, storageName)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(absolutePath, Buffer.from(fileBuf))

  try {
    const docId = await uploadFleetDocument({
      vehicleId,
      documentType,
      fileName: safeName,
      filePath: relativePath,
      fileSize: file.size,
      mimeType: validation.mimeType,
      expiresAt: expiresAt || null,
    }, session, serviceWorksiteScope(session))

    revalidatePath("/flota")
    revalidatePath(`/flota/${vehicleId}`)
    return { ok: true, message: "Documento subido", data: { id: docId } }
  } catch (e) {
    await fs.unlink(absolutePath).catch(() => undefined)
    logger.error("[uploadFleetDocumentAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al subir documento" }
  }
}

export async function deleteFleetDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("flota:manage_documents") }
  catch { return { ok: false, message: "Sin permisos para eliminar documentos" } }

  const documentId = formData.get("documentId") as string
  const vehicleId = formData.get("vehicleId") as string
  if (!documentId) return { ok: false, message: "Documento requerido" }

  try {
    await deleteFleetDocument(documentId, session, serviceWorksiteScope(session))
    revalidatePath("/flota")
    if (vehicleId) revalidatePath(`/flota/${vehicleId}`)
    return { ok: true, message: "Documento eliminado" }
  } catch (e) {
    logger.error("[deleteFleetDocumentAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al eliminar documento" }
  }
}
