export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"
import {
  DRILL_EVIDENCE_MAX_FILE_SIZE,
  DRILL_EVIDENCE_MAX_REQUEST_SIZE,
  uploadEmergencyDrillEvidence,
} from "@/lib/services/prevention-emergency"

/** Sube un único archivo; el formulario repite esta petición por cada archivo. */
export async function POST(request: Request) {
  const guard = await guardPermission("prevention:emergency:drill_execute")
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })

  const contentLengthHeader = request.headers.get("content-length")
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN
  if (Number.isFinite(contentLength) && contentLength > DRILL_EVIDENCE_MAX_REQUEST_SIZE) {
    return NextResponse.json({
      error: `La petición supera el máximo permitido de ${Math.round(DRILL_EVIDENCE_MAX_FILE_SIZE / 1024 / 1024)} MB por archivo.`,
    }, { status: 413 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Body inválido: se esperaba multipart/form-data." }, { status: 400 })
  }

  const drillId = String(form.get("drillId") ?? "").trim()
  const files = form.getAll("file")
  const file = files.length === 1 ? files[0] : null
  if (!drillId) return NextResponse.json({ error: "Falta el simulacro." }, { status: 400 })
  if (files.length !== 1) return NextResponse.json({ error: "Adjunta exactamente un archivo por solicitud." }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 })
  if (file.size > DRILL_EVIDENCE_MAX_FILE_SIZE) {
    return NextResponse.json({
      error: `El archivo supera el máximo permitido de ${Math.round(DRILL_EVIDENCE_MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    }, { status: 400 })
  }

  try {
    const result = await uploadEmergencyDrillEvidence({
      drillId,
      fileName: file.name,
      fileSize: file.size,
      buffer: new Uint8Array(await file.arrayBuffer()),
    }, {
      userId: guard.session.user.id,
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    return NextResponse.json({ evidence: result }, { status: 201 })
  } catch (error) {
    logger.error("[prevencion/emergencias/simulacros/evidencia]", error)
    return NextResponse.json({
      error: safeActionMessage(error, "No se pudo guardar la evidencia."),
    }, { status: 400 })
  }
}
