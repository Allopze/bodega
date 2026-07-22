/**
 * GET /api/bodega/kardex/export?faena=<id>&producto=<id>
 *
 * Returns inventory movement history as an Excel download, scoped by RBAC.
 */
import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getKardexExport } from "@/lib/services/stock"
import { logger } from "@/lib/logger"
import { encodeContentDisposition } from "@/lib/utils"

const MAX_EXPORT_ROWS = 10_000

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "warehouse:view_stock")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const worksiteId = req.nextUrl.searchParams.get("faena") ?? undefined
  const productId  = req.nextUrl.searchParams.get("producto") ?? undefined

  try {
    const { buffer, filename, truncated } = await getKardexExport(
      session,
      { worksiteId, productId },
      MAX_EXPORT_ROWS,
    )

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(filename, "attachment"),
        ...(truncated ? { "X-Row-Limit-Applied": "true" } : {}),
      },
    })
  } catch (err) {
    logger.error("[bodega/kardex/export]", err)
    return NextResponse.json({ error: "Error al generar el archivo" }, { status: 500 })
  }
}
