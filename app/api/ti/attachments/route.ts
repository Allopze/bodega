export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import path from "node:path"
import { guardPermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import { resolveTiDir, createTiFilePath } from "@/lib/storage/config"
import { createTiAttachment, isTiUploadableEntityType } from "@/lib/services/ti/attachments"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"

const MAX_FILE_SIZE = 25 * 1024 * 1024

/**
 * POST /api/ti/attachments — adjunta un documento (factura, orden de compra,
 * informe de servicio) a una entidad TI. Hoy solo admite `it_asset`: ver el
 * comentario de `TI_UPLOADABLE_ENTITY_TYPES` en `lib/services/ti/attachments.ts`
 * para por qué no se abren de entrada los otros tipos que el GET sabe leer.
 *
 * Calca el pipeline de `app/api/ti/photos/route.ts`: route handler (no server
 * action) porque `next.config.ts` limita el body de las server actions a 21MB
 * y el límite acá es 25MB, igual que las fotos.
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
  const entityType = String(form.get("entityType") ?? "it_asset")
  if (!isTiUploadableEntityType(entityType)) {
    return NextResponse.json({ error: "Este tipo de entidad no admite adjuntos." }, { status: 400 })
  }
  const entityId = String(form.get("entityId") ?? "").trim()
  if (!entityId) {
    return NextResponse.json({ error: "Falta la entidad de destino (entityId)." }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({
      error: `El archivo supera el máximo permitido de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    }, { status: 400 })
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  // `file.name` es obligatorio acá: la rama Office de `validateFileBuffer`
  // compara la extensión declarada contra el nombre; sin él, todo .docx/.xlsx
  // se rechaza como "contenido no coincide con la extensión ausente".
  const validated = validateFileBuffer(buffer, file.size, MimeType.DOCUMENT_LIBRARY, file.name)
  if (validated.error) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const storageName = generateStorageName(file.name)
  const dir = resolveTiDir()
  const absolutePath = path.join(/*turbopackIgnore: true*/ dir, storageName)
  const relativePath = createTiFilePath(storageName)

  // La escritura va dentro del `try`: un disco lleno o un volumen no montado
  // debe devolver el 400 con mensaje que la UI sabe mostrar, no un 500 opaco.
  try {
    await mkdirp(dir)
    await writeBuffer(absolutePath, Buffer.from(buffer))
  } catch (error) {
    logger.error("[ti:attachments:write]", error)
    return NextResponse.json({ error: "No se pudo guardar el archivo en el servidor." }, { status: 400 })
  }

  try {
    const id = await createTiAttachment({
      entityType,
      entityId,
      fileName: file.name,
      filePath: relativePath,
      fileSize: file.size,
      mimeType: validated.mimeType ?? file.type,
    }, {
      userId: guard.session!.user.id,
      userEmail: guard.session!.user.email ?? undefined,
    }, serviceWorksiteScope(guard.session))
    return NextResponse.json({ id }, { status: 201 })
  } catch (error) {
    // La DB o la guardia de faena falló: no dejamos basura en disco. Si el
    // borrado también falla, se loguea: como no hay borrado de adjuntos desde
    // la app, ese huérfano solo se limpia a mano y hay que poder encontrarlo.
    await removeFile(absolutePath).catch((cleanupError: unknown) => {
      logger.error("[ti:attachments:orphan]", { path: relativePath, cleanupError })
    })
    logger.error("[ti:attachments:upload]", error)
    return NextResponse.json({ error: safeActionMessage(error, "No se pudo registrar el documento.") }, { status: 400 })
  }
}
