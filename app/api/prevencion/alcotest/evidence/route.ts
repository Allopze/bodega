export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"
import {
  ALCOTEST_EVIDENCE_MAX_FILE_SIZE,
  ALCOTEST_EVIDENCE_MAX_REQUEST_SIZE,
  uploadAlcotestSlotEvidence,
} from "@/lib/services/prevention-alcotest-slots"

/** Sube un único archivo; el formulario repite esta petición por cada archivo. */
export async function POST(request: Request) {
  const guard = await guardPermission("prevention:alcotest:register")
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })

  const contentLengthHeader = request.headers.get("content-length")
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN
  if (Number.isFinite(contentLength) && contentLength > ALCOTEST_EVIDENCE_MAX_REQUEST_SIZE) {
    return NextResponse.json({
      error: `La petición supera el máximo permitido de ${Math.round(ALCOTEST_EVIDENCE_MAX_FILE_SIZE / 1024 / 1024)} MB por archivo.`,
    }, { status: 413 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Body inválido: se esperaba multipart/form-data." }, { status: 400 })
  }

  const slotId = String(form.get("slotId") ?? "").trim()
  const files = form.getAll("file")
  const file = files.length === 1 ? files[0] : null
  if (!slotId) return NextResponse.json({ error: "Falta la casilla del programa." }, { status: 400 })
  if (files.length !== 1) return NextResponse.json({ error: "Adjunta exactamente un archivo por solicitud." }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 })
  if (file.size > ALCOTEST_EVIDENCE_MAX_FILE_SIZE) {
    return NextResponse.json({
      error: `El archivo supera el máximo permitido de ${Math.round(ALCOTEST_EVIDENCE_MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    }, { status: 400 })
  }

  try {
    const evidence = await uploadAlcotestSlotEvidence({
      slotId,
      fileName: file.name,
      fileSize: file.size,
      buffer: new Uint8Array(await file.arrayBuffer()),
    }, {
      userId: guard.session.user.id,
      scope: resolveWorksiteScope(guard.session).mode === "all"
        ? "all"
        : (resolveWorksiteScope(guard.session).ids ?? []),
    })
    return NextResponse.json({ evidence }, { status: 201 })
  } catch (error) {
    logger.error("[prevencion/alcotest/evidence]", error)
    return NextResponse.json({ error: safeActionMessage(error, "No se pudo guardar la evidencia.") }, { status: 400 })
  }
}
