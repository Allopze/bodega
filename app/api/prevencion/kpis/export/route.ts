export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPdtpComplianceIndicators } from "@/lib/services/prevention-pdtp"
import { getIncidentFrequencyRate } from "@/lib/services/prevention-kpis"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:kpis:export")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  const year = Number(request.nextUrl.searchParams.get("anio")) || 2026
  const faena = request.nextUrl.searchParams.get("faena") ?? undefined

  try {
    const scope = resolveWorksiteScope(session)
    const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
    const indicators = await getPdtpComplianceIndicators(year, faena)
    const rate = faena ? await getIncidentFrequencyRate(faena, year, worksiteIds) : null
    const filenameBase = `kpis-preventivos-${year}`
    const xlsx = await buildXlsxBuffer({
      filenameBase,
      worksheetName: "KPIs",
      headers: ["Métrica", "Valor"],
      rows: indicators ? [
        ["Cumplimiento anual", `${Math.round((indicators.annual.percent ?? 0) * 100)}%`],
        ["Meta", `${Math.round(indicators.target * 100)}%`],
        ["Actividades planificadas", indicators.annual.planned],
        ["Actividades ejecutadas", indicators.annual.executed],
        ...(rate ? [
          ["Accidentes", rate.accidentCount],
          ["Horas hombre trabajadas (HHT)", rate.totalHours],
          ["Índice de frecuencia (IF)", rate.frequencyRate !== null ? rate.frequencyRate.toFixed(2) : "—"],
        ] : []),
        ...indicators.monthly.map((m) => [`Mes ${m.month}`, `${m.percent !== null ? `${Math.round(m.percent * 100)}%` : "—"} (${m.executed}/${m.planned})`]),
      ] : [],
    })
    return new NextResponse(xlsx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`${filenameBase}.xlsx`, "attachment"),
      },
    })
  } catch (err) {
    logger.error("[prevencion/kpis/export]", err)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
