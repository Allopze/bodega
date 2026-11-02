export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { historyVersion, loadAppHistory } from "@/lib/services/mantencion/app-history"
import { authenticateSyncRequest, syncErrorResponse, syncFailureResponse } from "@/lib/services/mantencion/sync-auth"
import { etagMatches } from "@/lib/services/mantencion/sync-catalog-version"

/**
 * GET /api/mantencion/sync/historial — historial de la flota para la app del
 * mecánico (los últimos registros vigentes de cada equipo activo, de todas las
 * faenas), con `ETag`. Autenticación: SÓLO `Authorization: Bearer` (ruta pública
 * para el proxy, ver `lib/security/public-paths.ts`).
 *
 * Va aparte del catálogo para no engordarlo. El contenido no depende de quién
 * pide, así que la versión tampoco. `If-None-Match` igual a la versión actual →
 * 304 sin armar nada; `version` del cuerpo es el mismo valor del `ETag`.
 */
export async function GET(request: Request) {
  const auth = await authenticateSyncRequest(request, { pathname: new URL(request.url).pathname })
  if (!auth.ok) return syncFailureResponse(auth.failure)

  try {
    const version = await historyVersion()
    const headers = { ETag: `"${version}"`, "Cache-Control": "private, no-cache" }
    if (etagMatches(request.headers.get("if-none-match"), version)) return new Response(null, { status: 304, headers })
    return Response.json(await loadAppHistory(auth.context.viewer, version), { headers })
  } catch (error) {
    return syncErrorResponse("historial", error)
  }
}
