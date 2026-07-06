export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { guardPermission } from "@/lib/auth/can"
import { importPdtpFromExcel } from "@/lib/services/prevention-pdtp"
import { logger } from "@/lib/logger"

const MAX_EXCEL_SIZE = 15 * 1024 * 1024

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
  const guard = await guardPermission("prevention:pdtp:manage")
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Body inválido: se esperaba multipart/form-data." }, { status: 400 })
  }

  const programId = String(form.get("programId") ?? "")
  if (!programId) {
    return NextResponse.json({ error: "Falta el programa (programId)." }, { status: 400 })
  }

  const file = form.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Selecciona un archivo Excel (.xlsx)." }, { status: 400 })
  }
  if (file.size > MAX_EXCEL_SIZE) {
    return NextResponse.json({
      error: `El archivo supera el límite de ${Math.round(MAX_EXCEL_SIZE / 1024 / 1024)} MB.`,
    }, { status: 400 })
  }
  if (!/\.xlsx?$/i.test(file.name)) {
    return NextResponse.json({ error: "El archivo debe ser .xlsx o .xls." }, { status: 400 })
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellFormula: true })
    const result = await importPdtpFromExcel({ programId, workbook, userId: guard.session.user.id })
    return NextResponse.json({
      ok: true,
      message: `${result.activityCount} actividades importadas en ${result.sheetCount} hojas.`,
    })
  } catch (err) {
    logger.error("[pdtp/import]", err)
    const message = err instanceof Error ? err.message : "Error al importar el Excel."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
