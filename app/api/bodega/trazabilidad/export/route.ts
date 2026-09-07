/**
 * GET /api/bodega/trazabilidad/export
 *
 * Devuelve la trazabilidad consolidada como descarga Excel. Acepta los mismos
 * filtros que la pantalla (`faena`, `estado`, `categoria`, `solicitante`,
 * `proveedor`, `q`, `pendientes`, `oc_pendiente`, `desde`/`hasta` — con los
 * alias históricos `from`/`to`): el archivo tiene que traer lo que el usuario
 * está mirando, no la faena completa.
 */
import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getTrazabilidadXlsx } from "@/lib/services/trazabilidad-export"
import { logger } from "@/lib/logger"
import { encodeContentDisposition } from "@/lib/utils"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "warehouse:view_traceability")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const param = (name: string) => sp.get(name) ?? undefined

  const filters = {
    fromDate:   param("desde") ?? param("from"),
    toDate:     param("hasta") ?? param("to"),
    worksiteId: param("faena"),
    estado:     param("estado"),
    categoria:  param("categoria"),
    solicitante: param("solicitante"),
    proveedor:  param("proveedor"),
    q:          param("q"),
    pendientes: sp.get("pendientes") === "true" || sp.get("pendientes") === "1",
    ocPendiente: sp.get("oc_pendiente") === "true" || sp.get("oc_pendiente") === "1",
  }

  try {
    // El techo de filas lo fija el servicio (`TRAZABILIDAD_EXPORT_MAX_ROWS`):
    // tenerlo también acá eran dos números que había que mantener iguales.
    const { buffer, filename, truncated } = await getTrazabilidadXlsx(session, filters)

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
