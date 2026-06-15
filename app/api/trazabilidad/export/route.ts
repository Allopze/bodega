/**
 * GET /api/trazabilidad/export?from=<date>&to=<date>&faena=<id>
 *
 * Returns the trazabilidad matrix as an XLSX download with optional filters.
 */
import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getTrazabilidadXlsx } from "@/lib/services/trazabilidad-export"
import { logger } from "@/lib/logger"

const MAX_EXPORT_ROWS = 10_000

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "reports:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const filters = {
    fromDate:   req.nextUrl.searchParams.get("from") ?? undefined,
    toDate:     req.nextUrl.searchParams.get("to") ?? undefined,
    worksiteId: req.nextUrl.searchParams.get("faena") ?? undefined,
  }

  try {
    const { buffer, filename, truncated } = await getTrazabilidadXlsx(session, filters, MAX_EXPORT_ROWS)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        ...(truncated ? { "X-Row-Limit-Applied": "true" } : {}),
      },
    })
  } catch (err) {
    logger.error("[trazabilidad/export]", err)
    return NextResponse.json({ error: "Error al generar el archivo" }, { status: 500 })
  }
}
