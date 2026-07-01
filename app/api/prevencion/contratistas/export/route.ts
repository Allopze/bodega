export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { buildContractorsExport } from "@/lib/services/prevention-contractors"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:contractors:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  try {
    const report = await buildContractorsExport()
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
    logger.error("[prevencion/contratistas/export]", err)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
