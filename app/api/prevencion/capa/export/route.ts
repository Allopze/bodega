export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildCapaExport } from "@/lib/services/prevention-capa"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:capa:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    const report = await buildCapaExport({
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    const bytes = await buildXlsxBuffer(report)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`${report.filenameBase}.xlsx`, "attachment"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(report.rowLimitApplied ? { "X-Row-Limit-Applied": "true" } : {}),
      },
    })
  } catch (error) {
    logger.error("[prevencion/capa/export]", error)
    return NextResponse.json({ error: "No se pudo generar el Excel CAPA" }, { status: 500 })
  }
}
