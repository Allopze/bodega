/**
 * GET /api/prevencion/pdtp/export
 * Exporta una hoja del Programa de Trabajo Preventivo SG-SST como XLSX.
 */

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { buildPdtpExport, assertWorksiteAccess } from "@/lib/services/prevention-pdtp"
import type { PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

const SHEET_CODES = new Set<PdtpSheetCode>([
  "pdtp_general",
  "cphs",
  "prf_adm_contrato",
  "sup_jt",
  "prf",
  "adm_contrato",
  "subgerente",
  "capacitacion",
])

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:pdtp:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const url = request.nextUrl
  const sheetCode = normalizeSheetCode(url.searchParams.get("hoja"))
  const worksiteId = url.searchParams.get("faena") || undefined
  const yearParam = Number.parseInt(url.searchParams.get("year") ?? "", 10)
  const currentYear = new Date().getFullYear()
  const minYear = 2024
  const maxYear = currentYear + 2
  const year = Number.isFinite(yearParam) && yearParam >= minYear && yearParam <= maxYear
    ? yearParam
    : currentYear
  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []

  try {
    if (worksiteId) assertWorksiteAccess(worksiteId, worksiteIds)
    const report = await buildPdtpExport({ year, sheetCode, worksiteId })
    const xlsx = await buildXlsxBuffer(report)

    return new NextResponse(xlsx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`${report.filenameBase}.xlsx`, "attachment"),
      },
    })
  } catch (err) {
    logger.error("[prevencion/pdtp/export]", err)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}

function normalizeSheetCode(value: string | null): PdtpSheetCode {
  if (value && SHEET_CODES.has(value as PdtpSheetCode)) return value as PdtpSheetCode
  return "pdtp_general"
}
