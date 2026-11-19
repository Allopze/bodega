/**
 * POST /api/apps/visita — registra que la persona entró a una app.
 *
 * Lo llama `AppVisitTracker` (barra superior) al cambiar de ruta. Sólo guarda
 * persona, app y día (ver `db/schema/app-visits.ts`); la ruta exacta no se
 * guarda. El proxy ya rechaza la mutación si viene de otro origen
 * (`isCrossOriginMutation`). Nunca falla en voz alta: medir el uso no puede
 * romper la navegación.
 */
import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/lib/auth/auth"
import { logger } from "@/lib/logger"
import { recordAppVisit } from "@/lib/services/app-visits"

export const dynamic = "force-dynamic"

const MAX_PATH_LENGTH = 512

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let pathname: unknown
  try {
    pathname = (await request.json() as { pathname?: unknown }).pathname
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 })
  }
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.length > MAX_PATH_LENGTH) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  try {
    await recordAppVisit(session.user.id, pathname)
  } catch (err) {
    logger.error("[apps/visita] No se pudo registrar la visita", err)
  }
  return new NextResponse(null, { status: 204 })
}
