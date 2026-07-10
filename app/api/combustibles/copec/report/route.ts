import { NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth/can"
import { downloadCopecReport, type CopecCardType } from "@/lib/combustibles/copec-reports"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    await requirePermission("combustibles:import")
    const { searchParams } = new URL(request.url)
    const cardType = searchParams.get("tipo")
    const from = searchParams.get("desde") ?? ""
    const to = searchParams.get("hasta") ?? ""
    if (cardType !== "TCT" && cardType !== "TAE") {
      return NextResponse.json({ ok: false, message: "El tipo debe ser TCT o TAE" }, { status: 400 })
    }
    const report = await downloadCopecReport({ cardType: cardType as CopecCardType, from, to })
    return new NextResponse(report.buffer as BodyInit, {
      headers: {
        "Content-Type": report.contentType,
        "Content-Disposition": `attachment; filename="${report.fileName.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible obtener el reporte de Copec"
    const status = message.includes("permisos") || message.includes("Unauthorized") ? 403 : 502
    return NextResponse.json({ ok: false, message }, { status })
  }
}
