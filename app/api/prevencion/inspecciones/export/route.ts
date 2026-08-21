export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildInspectionExport } from "@/lib/services/prevention-inspections-export"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:inspections:export")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    // Mismo parámetro que el filtro de la bandeja: el Excel baja lo que la
    // pantalla está mostrando. Un valor desconocido se ignora en vez de
    // rechazarse — el peor caso es exportar de más, no fallar la descarga.
    const tipo = new URL(request.url).searchParams.get("tipo")
    const kinds = tipo === "inspection" || tipo === "observation" || tipo === "audit" ? [tipo] : undefined

    const report = await buildInspectionExport({
      userId: session.user.id,
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    }, { kinds })
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
    logger.error("[prevencion/inspecciones/export]", error)
    return NextResponse.json({ error: "No se pudo generar el Excel de inspecciones" }, { status: 500 })
  }
}
