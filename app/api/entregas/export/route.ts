import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getEppDeliveryExport } from "@/lib/services/epp-delivery-export"
import { logger } from "@/lib/logger"
import { encodeContentDisposition } from "@/lib/utils"

const MAX_EXPORT_ROWS = 10_000

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "deliveries:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const worksiteId = req.nextUrl.searchParams.get("faena") ?? undefined

  try {
    const { buffer, filename, truncated } = await getEppDeliveryExport(
      session,
      { worksiteId },
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
    logger.error("[entregas/export]", err)
    return NextResponse.json({ error: "Error al generar el archivo" }, { status: 500 })
  }
}
