export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { mkdirp, writeBuffer } from "@/lib/storage/helpers"
import { createInspectionEvidencePath, resolveInspectionEvidenceDir, resolveStorageFile } from "@/lib/storage/config"
import { addAnswerEvidence, assertInspectionOperationEnabled } from "@/lib/services/prevention-inspections"
import { logger } from "@/lib/logger"
import { safeActionMessage } from "@/lib/action-error"

const MAX_FILE_SIZE = 25 * 1024 * 1024

/**
 * POST /api/prevencion/inspecciones/evidence
 *
 * Adjunta una foto a una respuesta de inspección. Espera multipart/form-data:
 *   - file: la imagen (obligatorio)
 *   - answerId: la respuesta a la que se adjunta (obligatorio)
 *   - caption: descripción opcional
 *
 * A diferencia del equivalente PDTP, aquí la fila se inserta en la misma
 * llamada: la evidencia cuelga de la respuesta (1-a-N) y devolver sólo la ruta
 * dejaría al cliente con un archivo huérfano si no llega a guardarla.
 *
 * El alcance de faena y que la inspección siga editable los comprueba
 * `addAnswerEvidence` contra el run real, no contra un `worksiteId` que venga
 * en el formulario.
 */
export async function POST(request: Request) {
  const guard = await guardPermission("prevention:inspections:execute")
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
  const answerId = String(form.get("answerId") ?? "")
  if (!answerId) {
    return NextResponse.json({ error: "Falta la respuesta (answerId)." }, { status: 400 })
  }
  const caption = String(form.get("caption") ?? "").trim() || null

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({
      error: `El archivo supera el máximo permitido de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    }, { status: 400 })
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const validated = validateFileBuffer(buffer, file.size, MimeType.PROOF)
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
    await writeBuffer(resolveStorageFile(dir, storageName), Buffer.from(buffer))
    const relativePath = createInspectionEvidencePath(storageName)
    const created = await addAnswerEvidence({ answerId, path: relativePath, caption }, access)
    return NextResponse.json({ id: created.id, path: created.path }, { status: 201 })
  } catch (err) {
    logger.error("[inspecciones/evidence]", err)
    const message = safeActionMessage(err, "Error al subir el archivo.")
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
