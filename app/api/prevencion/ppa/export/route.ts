/**
 * GET /api/prevencion/ppa/export
 * Exporta los PPA visibles para el usuario como XLSX.
 */

export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { buildPpaExport } from "@/lib/services/ppa"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "ppa:manage")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []

  const { searchParams } = new URL(request.url)
  const filters = {
    estado:    searchParams.get("estado")    || undefined,
    worksiteId: searchParams.get("worksiteId") || undefined,
    dateFrom:  searchParams.get("dateFrom")  || undefined,
    dateTo:    searchParams.get("dateTo")    || undefined,
    search:    searchParams.get("search")    || undefined,
  }

  try {
    const report = await buildPpaExport(worksiteIds, filters)
    const xlsx = await buildXlsxBuffer(report)
    return new NextResponse(xlsx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`${report.filenameBase}.xlsx`, "attachment"),
      },
    })
  } catch (err) {
    logger.error("[prevencion/ppa/export]", err)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
