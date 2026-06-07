/**
 * GET /api/reportes/export?tipo=<tipo>&formato=csv|xlsx
 *
 * Exports the requested report. CSV remains the default format.
 */

import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { buildCsv, buildXlsxBuffer, getReportData } from "@/lib/reports/export"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "reports:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const tipo = req.nextUrl.searchParams.get("tipo") ?? "gasto_faena"
  const formato = req.nextUrl.searchParams.get("formato") === "xlsx" ? "xlsx" : "csv"

  try {
    const report = await getReportData(tipo, session)

    if (formato === "xlsx") {
      const xlsx = await buildXlsxBuffer(report)
      return new NextResponse(xlsx, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${report.filenameBase}.xlsx"`,
        },
      })
    }

    const csv = buildCsv(report)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${report.filenameBase}.csv"`,
      },
    })
  } catch (err) {
    console.error("[reportes/export]", err)
    return NextResponse.json({ error: "Error al generar el reporte" }, { status: 500 })
  }
}
