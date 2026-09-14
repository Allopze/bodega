export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import { createTiFilePath, resolveStorageFile, resolveTiDir } from "@/lib/storage/config"
import { persistPendingPhoto } from "@/lib/services/ti/assignment-photos"
import { logger } from "@/lib/logger"
import { safeActionMessage } from "@/lib/action-error"

const MAX_FILE_SIZE = 25 * 1024 * 1024

/**
 * POST /api/ti/photos — sube una fotografía de evidencia de entrega o devolución.
 *
 * Todas las cargas quedan pendientes hasta que el acta se confirma: las de
 * entrega no tienen aún asignación y las de devolución conservan su asignación
 * objetivo en pendingAssignmentId. Solo la transacción del acta las ancla.
 */
export async function POST(request: Request) {
  const guard = await guardPermission("ti:manage_assets")
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Body inválido: se esperaba multipart/form-data." }, { status: 400 })
  }

  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo (file)." }, { status: 400 })
  }
  const stage = String(form.get("stage") ?? "delivery")
  if (stage !== "delivery" && stage !== "return") {
    return NextResponse.json({ error: "Etapa inválida (stage)." }, { status: 400 })
  }
  const assignmentId = String(form.get("assignmentId") ?? "").trim() || null
  const caption = String(form.get("caption") ?? "").trim() || null

  if (stage === "delivery" && assignmentId) {
    return NextResponse.json({ error: "Las fotos de entrega se cargan antes de crear el acta." }, { status: 400 })
  }
  if (stage === "return" && !assignmentId) {
    return NextResponse.json({ error: "La foto de devolución requiere una asignación vigente." }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({
      error: `El archivo supera el máximo permitido de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    }, { status: 400 })
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const validated = validateFileBuffer(buffer, file.size, MimeType.IMAGE, file.name)
  if (validated.error) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const storageName = generateStorageName(file.name)
  const dir = resolveTiDir()
  await mkdirp(dir)
  await writeBuffer(resolveStorageFile(dir, storageName), Buffer.from(buffer))
  const relativePath = createTiFilePath(storageName)

  try {
    const id = await persistPendingPhoto({
      stage,
      pendingAssignmentId: stage === "return" ? assignmentId : null,
      fileName: file.name,
      filePath: relativePath,
      fileSize: file.size,
      mimeType: validated.mimeType ?? file.type,
      caption,
      uploadedByUserId: guard.session!.user.id,
    }, serviceWorksiteScope(guard.session))
    return NextResponse.json({ id }, { status: 201 })
  } catch (error) {
    // La DB o la validación del acta falló: no dejamos basura en disco.
    await removeFile(resolveStorageFile(dir, storageName)).catch(() => undefined)
    logger.error("[ti:photos:upload]", error)
    return NextResponse.json({ error: safeActionMessage(error, "No se pudo registrar la fotografía.") }, { status: 400 })
  }
}
