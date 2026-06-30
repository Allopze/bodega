export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { buildEppMatrixExport } from "@/lib/services/prevention-epp-matrix"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:epp_matrix:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const faena = request.nextUrl.searchParams.get("faena")
  if (!faena) return NextResponse.json({ error: "Faena requerida" }, { status: 400 })

  try {
    const report = await buildEppMatrixExport(faena, worksiteIds)
    const xlsx = await buildXlsxBuffer({
      filenameBase: report.filenameBase,
      worksheetName: report.worksheetName,
      headers: report.headers,
      rows: report.rows,
    })
    return new NextResponse(xlsx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`${report.filenameBase}.xlsx`, "attachment"),
      },
    })
  } catch (err) {
    logger.error("[prevencion/epp/matriz/export]", err)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
