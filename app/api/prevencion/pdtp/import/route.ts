export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { applyPdtpImportBatch, cancelPdtpImportBatch, stagePdtpXlsxImport } from "@/lib/services/prevention-pdtp"
import { logger } from "@/lib/logger"
import { safeActionMessage } from "@/lib/action-error"
import { XLSX_MAX_BYTES } from "@/lib/services/xlsx-security"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

/**
 * POST /api/prevencion/pdtp/import
 *
 * Importa un Excel PDTP a un programa en borrador. Vive en una API route
 * (no un Server Action) porque el archivo real ("PROGRAMA DE TRABAJO
 * PREVENTIVO SG-SST.xlsx") pesa ~4-5 MB y Next.js limita el body de los
 * Server Actions a 1 MB por defecto — un Server Action fallaría con
 * "Body exceeded 1 MB limit" para cualquier workbook real. Mismo patrón que
 * /api/prevencion/pdtp/evidence.
 */
export async function POST(request: Request) {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Body inválido: se esperaba multipart/form-data." }, { status: 400 })
  }

  const mode = String(form.get("mode") ?? "stage")
  if (mode === "apply") {
    const batchId = String(form.get("batchId") ?? "")
    if (!batchId) return NextResponse.json({ error: "Falta el lote de importación." }, { status: 400 })
    try {
      const result = await applyPdtpImportBatch({
        batchId,
        userId: guard.session.user.id,
        worksiteId: String(form.get("worksiteId") ?? "") || undefined,
        acceptMissingEvidence: String(form.get("acceptMissingEvidence") ?? "") === "true",
        acceptanceReason: String(form.get("acceptanceReason") ?? "") || undefined,
        scope: scopeToIds(resolveWorksiteScope(guard.session)),
      })
      return NextResponse.json({ ok: true, message: "Lote aplicado correctamente.", result })
    } catch (err) {
      logger.error("[pdtp/import/apply]", err)
      const message = safeActionMessage(err, "Error al aplicar el lote de importación.")
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }
  if (mode === "cancel") {
    const batchId = String(form.get("batchId") ?? "")
    if (!batchId) return NextResponse.json({ error: "Falta el lote de importación." }, { status: 400 })
    try {
      const result = await cancelPdtpImportBatch({
        batchId,
        userId: guard.session.user.id,
        reason: String(form.get("reason") ?? ""),
      })
      return NextResponse.json({ ok: true, message: "Preview cancelado sin modificar el programa.", result })
    } catch (err) {
      logger.error("[pdtp/import/cancel]", err)
      const message = safeActionMessage(err, "Error al cancelar el lote de importación.")
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }
  if (mode !== "stage") return NextResponse.json({ error: "Operación de importación no reconocida." }, { status: 400 })

  const programId = String(form.get("programId") ?? "")
  if (!programId) return NextResponse.json({ error: "Falta el programa (programId)." }, { status: 400 })

  const file = form.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Selecciona un archivo Excel (.xlsx)." }, { status: 400 })
  }
  if (file.size > XLSX_MAX_BYTES) {
    return NextResponse.json({
      error: `El archivo supera el límite de ${Math.round(XLSX_MAX_BYTES / 1024 / 1024)} MB.`,
    }, { status: 400 })
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json({ error: "El archivo debe ser .xlsx; .xls no está permitido." }, { status: 400 })
  }

  try {
    const result = await stagePdtpXlsxImport({
      programId,
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: file.type,
      userId: guard.session.user.id,
    })
    return NextResponse.json({
      ok: true,
      message: "Archivo analizado. Revisa el preview antes de aplicar.",
      batchId: result.batch.id,
      preview: result.preview,
    })
  } catch (err) {
    logger.error("[pdtp/import]", err)
    const message = safeActionMessage(err, "Error al importar el Excel.")
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
