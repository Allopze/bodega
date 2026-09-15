export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { guardAnyPermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import {
  PREVENTION_EVIDENCE_MAX_FILE_SIZE,
  PreventionEvidenceError,
  storePreventionEvidence,
} from "@/lib/services/prevention-evidence-upload"

/**
 * POST /api/prevencion/cgrd/evidence
 *
 * Sube la evidencia de un acto del CGRD: el acta de constitución del comité o
 * de designación del coordinador (N°79), el documento de la matriz publicada
 * (N°80) o el acta de una sesión (N°81). Devuelve `{ path, checksumSha256 }`;
 * la ruta es lo que el formulario manda como `evidenceUrl`.
 *
 * Los tres actos tienen permisos distintos y cada uno se verifica en su propio
 * servicio al guardar. Acá basta con tener alguno de ellos: subir un archivo
 * sin llegar a usarlo no acredita nada, y pedir los tres dejaría al PRF —que
 * sólo tiene `matrix:edit`— sin poder adjuntar el acta de su comité.
 */
export async function POST(request: Request) {
  const guard = await guardAnyPermission([
    "prevention:cgrd:committee:manage",
    "prevention:cgrd:matrix:publish",
    "prevention:cgrd:meeting:manage",
  ])
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Body inválido: se esperaba multipart/form-data." }, { status: 400 })
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
    const result = await storePreventionEvidence({
      domain: "cgrd",
      fileName: file.name,
      fileSize: file.size,
      buffer: new Uint8Array(await file.arrayBuffer()),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof PreventionEvidenceError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error("[prevencion/cgrd/evidence]", error)
    return NextResponse.json({ error: "No se pudo guardar la evidencia." }, { status: 400 })
  }
}
