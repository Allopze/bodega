export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildTrainingOccurrenceExport } from "@/lib/services/prevention-training-export"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { resolveTrainingOccurrenceYear } from "@/lib/services/prevention-training-occurrences"

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:training:export")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    const url = new URL(request.url)
    const worksiteId = url.searchParams.get("faena")?.trim() || undefined
    const report = await buildTrainingOccurrenceExport({
      userId: session.user.id,
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    }, {
      year: await resolveTrainingOccurrenceYear(url.searchParams.get("year") ?? url.searchParams.get("anio")),
      worksiteId,
    })
    const bytes = await buildXlsxBuffer(report)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`${report.filenameBase}.xlsx`, "attachment"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    logger.error("[prevencion/capacitacion/export]", error)
    return NextResponse.json({ error: "No se pudo generar el Excel de capacitación" }, { status: 500 })
  }
}
