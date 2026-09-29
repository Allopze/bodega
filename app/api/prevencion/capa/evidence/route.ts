export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { assertCapaEvidenceUploadAllowed } from "@/lib/services/prevention-capa"
import {
  PREVENTION_EVIDENCE_MAX_FILE_SIZE,
  PreventionEvidenceError,
  storePreventionEvidence,
} from "@/lib/services/prevention-evidence-upload"

/**
 * POST /api/prevencion/capa/evidence
 *
 * Sube el acta o la fotografía con que se implementa una acción CAPA. Devuelve
 * `{ path, checksumSha256 }`; el formulario registra la evidencia con esa ruta
 * y ese checksum, que es lo que el contrato de evidencia exige a un documento o
 * una foto. Antes no había dónde subir el archivo y sólo una URL pasaba.
 *
 * El permiso es el mismo que registrar evidencia (`prevention:capa:complete`) y
 * la faena es la de la CAPA: sin `actionId` no se sabe contra qué faena medir.
 */
export async function POST(request: Request) {
  const guard = await guardPermission("prevention:capa:complete")
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Body inválido: se esperaba multipart/form-data." }, { status: 400 })
  }

  const actionId = form.get("actionId")
  if (typeof actionId !== "string" || actionId.trim().length === 0) {
    return NextResponse.json({ error: "Falta la acción CAPA (actionId)." }, { status: 400 })
  }
  const files = form.getAll("file")
  const file = files.length === 1 ? files[0] : null
  if (files.length !== 1) return NextResponse.json({ error: "Adjunta exactamente un archivo por solicitud." }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo (file)." }, { status: 400 })
  if (file.size > PREVENTION_EVIDENCE_MAX_FILE_SIZE) {
    return NextResponse.json({
      error: `El archivo supera el máximo permitido de ${Math.round(PREVENTION_EVIDENCE_MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    }, { status: 400 })
  }

  try {
    await assertCapaEvidenceUploadAllowed({
      actionId: actionId.trim(),
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
  } catch (error) {
    // Mismo mensaje para inexistente y ajena: no revela que la CAPA existe.
    const message = error instanceof Error ? error.message : "Acción CAPA no encontrada o fuera de alcance."
    return NextResponse.json({ error: message }, { status: 404 })
  }

  try {
    const result = await storePreventionEvidence({
      domain: "capa",
      fileName: file.name,
      fileSize: file.size,
      buffer: new Uint8Array(await file.arrayBuffer()),
      uploadedByUserId: guard.session.user.id,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof PreventionEvidenceError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error("[prevencion/capa/evidence]", error)
    return NextResponse.json({ error: "No se pudo guardar la evidencia." }, { status: 400 })
  }
}
