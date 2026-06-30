export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getPdtpComplianceIndicators } from "@/lib/services/prevention-pdtp"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:kpis:export")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  try {
    const indicators = await getPdtpComplianceIndicators(2026)
    const xlsx = await buildXlsxBuffer({
      filenameBase: "kpis-preventivos-2026",
      worksheetName: "KPIs",
      headers: ["Métrica", "Valor"],
      rows: indicators ? [
        ["Cumplimiento anual", `${Math.round((indicators.annual.percent ?? 0) * 100)}%`],
        ["Meta", `${Math.round(indicators.target * 100)}%`],
        ["Actividades planificadas", indicators.annual.planned],
        ["Actividades ejecutadas", indicators.annual.executed],
        ...indicators.monthly.map((m) => [`Mes ${m.month}`, `${m.percent !== null ? `${Math.round(m.percent * 100)}%` : "—"} (${m.executed}/${m.planned})`]),
      ] : [],
    })
    return new NextResponse(xlsx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition("kpis-preventivos-2026.xlsx", "attachment"),
      },
    })
  } catch (err) {
    logger.error("[prevencion/kpis/export]", err)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
