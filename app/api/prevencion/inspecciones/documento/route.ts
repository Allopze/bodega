export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import path from "node:path"
import { createHash } from "node:crypto"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { mkdirp, writeBuffer } from "@/lib/storage/helpers"
import { resolveInspectionEvidenceDir, createInspectionEvidencePath } from "@/lib/storage/config"
import { addRunDocument, assertInspectionOperationEnabled } from "@/lib/services/prevention-inspections"
import { detectMarksInPhoto } from "@/lib/services/inspection-forms/detect-marks"
import { logger } from "@/lib/logger"

const MAX_FILE_SIZE = 25 * 1024 * 1024

/**
 * POST /api/prevencion/inspecciones/documento
 *
 * Adjunta la foto de la planilla física a una inspección. multipart/form-data:
 *   - file: la imagen (obligatorio)
 *   - runId: la inspección (obligatorio)
 *   - caption: descripción opcional
 *
 * Guarda bajo el mismo directorio que la evidencia por respuesta: es el mismo
 * tipo de archivo con el mismo ciclo de vida, y el GC de evidencias ya lo
 * recorre. Lo que cambia es a qué cuelga —el run, no una respuesta— y por eso
 * la tabla es propia.
 *
 * Permiso `:ingest` y no `:execute`: quien sube la planilla no es
 * necesariamente quien puede ejecutar inspecciones, y a la fecha de esto ese
 * usuario todavía no está definido. El alcance de faena lo comprueba
 * `addRunDocument` contra el run real.
 */
export async function POST(request: Request) {
  const guard = await guardPermission("prevention:inspections:ingest")
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
  const runId = String(form.get("runId") ?? "")
  if (!runId) {
    return NextResponse.json({ error: "Falta la inspección (runId)." }, { status: 400 })
  }
  const caption = String(form.get("caption") ?? "").trim() || null

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({
      error: `El archivo supera el máximo permitido de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    }, { status: 400 })
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const validated = validateFileBuffer(buffer, file.size, MimeType.INSPECTION_DOCUMENT, file.name)
  if (validated.error) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const session = guard.session!
  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }

  try {
    // INS-15: el toggle del submódulo sólo lo aplicaban las server actions,
    // así que con Inspecciones apagado se podía seguir adjuntando archivos.
    await assertInspectionOperationEnabled()
    const storageName = generateStorageName(file.name)
    const dir = resolveInspectionEvidenceDir()
    await mkdirp(dir)
    await writeBuffer(path.join(/*turbopackIgnore: true*/ dir, storageName), Buffer.from(buffer))
    const relativePath = createInspectionEvidencePath(storageName)

    // Modo sombra: se lee la planilla y se guarda lo leído, pero NO se
    // pre-llena ninguna respuesta. Sirve para medir el detector contra lo que
    // teclea la persona antes de confiarle un pre-llenado que después alguien
    // ratifica. Un fallo de lectura no puede tumbar la subida: la foto es la
    // evidencia, el reconocimiento es un extra.
    let extraction: Awaited<ReturnType<typeof detectMarksInPhoto>> | null = null
    if (file.type.startsWith("image/")) {
      try {
        extraction = await detectMarksInPhoto(Buffer.from(buffer))
      } catch (err) {
        logger.error("[inspecciones/documento] detección de marcas", err)
      }
    }

    const created = await addRunDocument({
      runId,
      path: relativePath,
      fileName: file.name,
      mimeType: validated.mimeType,
      fileSize: file.size,
      checksumSha256: createHash("sha256").update(buffer).digest("hex"),
      caption,
      extraction: extraction && extraction.cells.length > 0
        ? { layoutVersion: extraction.layoutVersion, cells: extraction.cells }
        : null,
    }, access)
    return NextResponse.json({
      id: created.id,
      path: created.path,
      // El cliente no usa esto para llenar nada; sirve para avisar que la foto
      // no se pudo leer y conviene repetirla plana.
      read: extraction ? { cells: extraction.cells.length, warning: extraction.warning } : null,
    }, { status: 201 })
  } catch (err) {
    logger.error("[inspecciones/documento]", err)
    const message = err instanceof Error ? err.message : "Error al subir el archivo."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
