/**
 * GET /api/trazabilidad/export — compatibilidad.
 *
 * La trazabilidad se mudó bajo Bodega y este endpoint quedó duplicado con
 * `/api/bodega/trazabilidad/export`: dos copias del mismo handler que había
 * que mantener sincronizadas (y que ya habían divergido en los alias de
 * fecha). Redirige preservando la query en vez de reimplementar.
 */
import { type NextRequest, NextResponse } from "next/server"

export function GET(req: NextRequest) {
  const target = new URL("/api/bodega/trazabilidad/export", req.nextUrl.origin)
  target.search = req.nextUrl.search
  // 308: preserva el método y le dice al cliente que la mudanza es permanente.
  return NextResponse.redirect(target, 308)
}
