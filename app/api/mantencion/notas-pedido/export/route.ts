/**
 * GET /api/mantencion/notas-pedido/export?estado=&faena=&q=&situacion=&urgencia=&desde=&hasta=&solicitante=&equipo=&articulo=
 *
 * Excel de la bandeja de notas de pedido con los MISMOS filtros que la pantalla (los lee `parsePartsNoteFilters`, el
 * mismo parser de la página). Exige `mant:np:export` en el servidor: sin sesión contesta 401 y sin permiso 403 con un
 * mensaje, nunca una redirección. El alcance de faena lo aplica el servicio, igual que la bandeja. Sin `estado` exporta
 * todas las pestañas.
 */
import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { logger } from "@/lib/logger"
import { encodeContentDisposition } from "@/lib/utils"
import { isInboxTab, parsePartsNoteFilters, type RawSearchParams } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-format"
import { exportPartsNotes } from "@/lib/services/mantencion/parts-notes/export"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const raw: RawSearchParams = Object.fromEntries(req.nextUrl.searchParams)
  const estado = typeof raw.estado === "string" ? raw.estado.trim() : undefined
  // «Por conciliar» no es una lista de notas: exportar desde ahí trae todas las notas.
  const tab = isInboxTab(estado, true) && estado !== "por_conciliar" ? estado : undefined

  try {
    const outcome = await exportPartsNotes({ session, filters: { ...parsePartsNoteFilters(raw), ...(tab ? { tab } : {}) } })
    if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: 403 })
    return new NextResponse(outcome.buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(outcome.filename, "attachment"),
        ...(outcome.truncated ? { "X-Row-Limit-Applied": "true" } : {}),
      },
    })
  } catch (error) {
    logger.error("[mantencion/notas-pedido/export]", error)
    return NextResponse.json({ error: "Error al generar el archivo" }, { status: 500 })
  }
}
