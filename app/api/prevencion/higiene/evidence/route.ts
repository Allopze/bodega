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
 * POST /api/prevencion/higiene/evidence
 *
 * Sube el informe del laboratorio que respalda una medición de exposición
 * (N°45). Devuelve `{ path, checksumSha256 }`; la ruta es lo que el formulario
 * manda junto con la medición, y el servicio la vuelve a leer del disco para
 * calcular sus metadatos en vez de confiar en lo que viaja por el cliente.
 */
export async function POST(request: Request) {
  const guard = await guardAnyPermission(["prevention:hygiene:measure"])
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
      domain: "hygiene",
      fileName: file.name,
      fileSize: file.size,
      buffer: new Uint8Array(await file.arrayBuffer()),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof PreventionEvidenceError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error("[prevencion/higiene/evidence]", error)
    return NextResponse.json({ error: "No se pudo guardar la evidencia." }, { status: 400 })
  }
}
