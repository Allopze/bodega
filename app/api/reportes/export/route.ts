/**
 * GET /api/reportes/export?tipo=<tipo>&from=<date>&to=<date>&faena=<id>&status=<status>
 *
 * Exports the requested report as XLSX with optional filters.
 */

import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { buildXlsxBuffer, getReportData, type ExportFilters } from "@/lib/reports/export"
import { logger } from "@/lib/logger"

const REPORT_TYPES = new Set([
  "gasto_faena",
  "items_sin_oc",
  "oc_por_estado",
])

const MAX_EXPORT_ROWS = 10_000

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "reports:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const tipo = req.nextUrl.searchParams.get("tipo") ?? "gasto_faena"
  if (!REPORT_TYPES.has(tipo)) {
    return NextResponse.json({ error: "Tipo de reporte inválido" }, { status: 400 })
  }

  const filters: ExportFilters = {}
  const from = req.nextUrl.searchParams.get("from")
  const to = req.nextUrl.searchParams.get("to")
  const faena = req.nextUrl.searchParams.get("faena")
  const status = req.nextUrl.searchParams.get("status")
  if (from) filters.fromDate = from
  if (to) filters.toDate = to
  if (faena) filters.worksiteId = faena
  if (status) filters.status = status

  try {
    const report = await getReportData(tipo, session, filters, MAX_EXPORT_ROWS)

    const xlsx = await buildXlsxBuffer(report)
    const headers: Record<string, string> = {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${report.filenameBase}.xlsx"`,
    }
    if (report.rowLimitApplied) {
      headers["X-Row-Limit-Applied"] = "true"
    }
    return new NextResponse(xlsx, {
      status: 200,
      headers,
    })
  } catch (err) {
    logger.error("[reportes/export]", err)
    return NextResponse.json({ error: "Error al generar el reporte" }, { status: 500 })
  }
}
