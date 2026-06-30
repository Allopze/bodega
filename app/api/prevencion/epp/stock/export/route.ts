export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getStockThresholds } from "@/lib/services/prevention-epp-matrix"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:epp_stock:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const faena = request.nextUrl.searchParams.get("faena")
  if (!faena) return NextResponse.json({ error: "Faena requerida" }, { status: 400 })

  try {
    const rows = await getStockThresholds(faena, worksiteIds)
    const xlsx = await buildXlsxBuffer({
      filenameBase: `stock-epp-${faena}`,
      worksheetName: "Stock EPP",
      headers: ["EPP ProductId", "Stock mínimo", "Stock crítico"],
      rows: rows.map((r) => [r.eppProductId, r.minStock, r.criticalStock]),
    })
    return new NextResponse(xlsx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`stock-epp-${faena}.xlsx`, "attachment"),
      },
    })
  } catch (err) {
    logger.error("[prevencion/epp/stock/export]", err)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}
