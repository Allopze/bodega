export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildInspectionExport } from "@/lib/services/prevention-inspections-export"
import { assertInspectionOperationEnabled } from "@/lib/services/prevention-inspections"
import { ModuleDisabledError } from "@/lib/services/module-toggles"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { encodeContentDisposition, formatDate } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { parseInspectionListQuery } from "@/lib/prevention/inspection-list-query"

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:inspections:export")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    // INS-15: mismo toggle que las server actions; sin esto el Excel seguía
    // descargándose con el submódulo apagado.
    await assertInspectionOperationEnabled()
    // El mismo parser alimenta filas, total y Excel. Así no hay un filtro
    // visible que desaparezca silenciosamente al descargar.
    const { filter } = parseInspectionListQuery(new URL(request.url).searchParams)

    const report = await buildInspectionExport({
      userId: session.user.id,
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    }, filter)
    // REP-002: con el contexto el libro gana la hoja «Metadatos» (quién, cuándo, con
    // qué filtros). Los filtros van con las palabras de la pantalla, no como ids.
    const bytes = await buildXlsxBuffer(report, {
      session,
      filters: report.filterSummary,
      from: filter.executedFrom ? formatDate(filter.executedFrom) : null,
      to: filter.executedTo ? formatDate(filter.executedTo) : null,
    })
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
    // Un submódulo apagado no es un fallo del servidor: es una negativa, y no se
    // ensucia el log con ella.
    if (error instanceof ModuleDisabledError) {
      return NextResponse.json({ error: "El submódulo Inspecciones está desactivado." }, { status: 403 })
    }
    logger.error("[prevencion/inspecciones/export]", error)
    return NextResponse.json({ error: "No se pudo generar el Excel de inspecciones" }, { status: 500 })
  }
}
