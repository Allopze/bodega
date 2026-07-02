export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { buildDocumentsExport } from "@/lib/services/prevention-documents-library"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:docs:export")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const scope = resolveWorksiteScope(session)

  const url = new URL(request.url)
  const filters = {
    q:          url.searchParams.get("q") ?? undefined,
    categorySlug: url.searchParams.get("categorySlug") ?? undefined,
    status:     url.searchParams.get("status") ?? undefined,
    worksiteId: url.searchParams.get("worksiteId") ?? undefined,
    page:       1,
    pageSize:   10_000,
  }

  try {
    const report = await buildDocumentsExport(scope, filters as never)
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
    logger.error("[documentacion/export]", err)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
