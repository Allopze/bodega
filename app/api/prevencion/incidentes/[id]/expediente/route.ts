export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { buildIncidentCaseExport } from "@/lib/services/prevention-incident-export"
import { encodeContentDisposition } from "@/lib/utils"

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:incidents:export") || !can(session, "prevention:incidents:view")) return NextResponse.json({ error: "No encontrado" }, { status: 404 })
  const { id } = await context.params
  const includeSensitive = request.nextUrl.searchParams.get("includeSensitive") === "1"
  const purpose = request.nextUrl.searchParams.get("purpose") ?? undefined
  if (includeSensitive && !can(session, "prevention:incidents:view_sensitive")) return NextResponse.json({ error: "No encontrado" }, { status: 404 })
  try {
    const report = await buildIncidentCaseExport({
      incidentId: id,
      includeSensitive,
      purpose,
      access: {
        ctx: { userId: session.user.id, ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: request.headers.get("user-agent") ?? undefined },
        scope: resolveWorksiteScope(session),
        permissions: session.user.permissions,
      },
    })
    if (!report) return NextResponse.json({ error: "No encontrado" }, { status: 404 })
    const bytes = await buildXlsxBuffer(report)
    return new NextResponse(bytes, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": encodeContentDisposition(`${report.filenameBase}.xlsx`, "attachment"),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    } })
  } catch (error) {
    logger.error("[prevencion/incidentes/expediente]", error)
    return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }
}
