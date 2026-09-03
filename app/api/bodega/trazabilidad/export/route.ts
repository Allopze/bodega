/**
 * GET /api/bodega/trazabilidad/export?from=<date>&to=<date>&faena=<id>
 *
 * Returns the consolidated tracking report as an Excel download.
 */
import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getTrazabilidadXlsx } from "@/lib/services/trazabilidad-export"
import { logger } from "@/lib/logger"
import { encodeContentDisposition } from "@/lib/utils"

const MAX_EXPORT_ROWS = 10_000

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "warehouse:view_traceability")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const filters = {
    fromDate:   req.nextUrl.searchParams.get("from") ?? req.nextUrl.searchParams.get("desde") ?? undefined,
    toDate:     req.nextUrl.searchParams.get("to") ?? req.nextUrl.searchParams.get("hasta") ?? undefined,
    worksiteId: req.nextUrl.searchParams.get("faena") ?? undefined,
  }

  try {
    const { buffer, filename, truncated } = await getTrazabilidadXlsx(session, filters, MAX_EXPORT_ROWS)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(filename, "attachment"),
        ...(truncated ? { "X-Row-Limit-Applied": "true" } : {}),
      },
    })
  } catch (err) {
    logger.error("[bodega/trazabilidad/export]", err)
    return NextResponse.json({ error: "Error al generar el archivo" }, { status: 500 })
  }
}
