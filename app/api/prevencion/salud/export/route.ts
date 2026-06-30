export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { listMinsalProtocols } from "@/lib/services/prevention-health"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:health:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  try {
    const rows = await listMinsalProtocols()
    const xlsx = await buildXlsxBuffer({
      filenameBase: "protocolos-minsal",
      worksheetName: "Protocolos MINSAL",
      headers: ["Código", "Nombre", "Marco legal", "Periodicidad (meses)"],
      rows: rows.map((p) => [p.code, p.name, p.legalFramework, p.periodicityMonths]),
    })
    return new NextResponse(xlsx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition("protocolos-minsal.xlsx", "attachment"),
      },
    })
  } catch (err) {
    logger.error("[prevencion/salud/export]", err)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
