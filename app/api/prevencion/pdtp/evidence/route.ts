export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { assertWorksiteAccess, type WorksiteScope } from "@/lib/services/prevention-pdtp"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { mkdirp, writeBuffer } from "@/lib/storage/helpers"
import { resolvePdtpEvidenceDir, createPdtpEvidencePath } from "@/lib/storage/config"
import { logger } from "@/lib/logger"
import path from "node:path"

const MAX_FILE_SIZE = 25 * 1024 * 1024

/**
 * POST /api/prevencion/pdtp/evidence
 *
 * Sube un único archivo de evidencia (foto o documento) para un registro de
 * ejecución PDTP. Acepta multipart/form-data con los campos:
 *   - file: el archivo (obligatorio, PDF/JPEG/PNG)
 *   - worksiteId: id de la faena (obligatorio)
 *
 * No implementa deduplicación, versionado ni un endpoint de visualización —
 * su único trabajo es validar un archivo, guardarlo y devolver su ruta.
 * Devuelve 201 con { path } o 4xx con detalle.
 */
export async function POST(request: Request) {
  const guard = await guardPermission("prevention:pdtp:execute")
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })

  const session = guard.session
  const scope = resolveWorksiteScope(session)
  const scopeIds: WorksiteScope = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []

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

  const worksiteId = String(form.get("worksiteId") ?? "")
  if (!worksiteId) {
    return NextResponse.json({ error: "Falta la faena (worksiteId)." }, { status: 400 })
  }

  try {
    assertWorksiteAccess(worksiteId, scopeIds)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sin acceso a la faena."
    return NextResponse.json({ error: message }, { status: 403 })
  }

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

  try {
    const storageName = generateStorageName(file.name)
    const dir = resolvePdtpEvidenceDir()
    await mkdirp(dir)
    await writeBuffer(path.join(/*turbopackIgnore: true*/ dir, storageName), Buffer.from(buffer))
    const relativePath = createPdtpEvidencePath(storageName)
    return NextResponse.json({ path: relativePath }, { status: 201 })
  } catch (err) {
    logger.error("[pdtp/evidence]", err)
    const message = err instanceof Error ? err.message : "Error al subir el archivo."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
