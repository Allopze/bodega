export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { buildCatalog, buildOthersCatalog } from "@/lib/services/mantencion/catalog"
import { authenticateSyncRequest, syncErrorResponse, syncFailureResponse } from "@/lib/services/mantencion/sync-auth"
import { catalogVersion, etagMatches, type CatalogScope } from "@/lib/services/mantencion/sync-catalog-version"
import { invalidResponse } from "@/lib/services/mantencion/sync-http"

/**
 * GET /api/mantencion/sync/catalogo[?alcance=mias|todos] — catálogo de la app
 * del mecánico con `ETag`. Autenticación: SÓLO `Authorization: Bearer` (ruta
 * pública para el proxy, ver `lib/security/public-paths.ts`).
 *
 * `If-None-Match` igual a la versión actual → 304 sin armar nada. La versión
 * incluye lo propio de quien pide (sus faenas) y el día de hoy.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const auth = await authenticateSyncRequest(request, { pathname: url.pathname })
  if (!auth.ok) return syncFailureResponse(auth.failure)

  const requested = url.searchParams.get("alcance") ?? "mias"
  if (requested !== "mias" && requested !== "todos") return invalidResponse("El alcance pedido no existe (usa «mias» o «todos»).", "alcance")
  const scope: CatalogScope = requested

  try {
    const version = await catalogVersion(auth.context.viewer, scope)
    const headers = { ETag: `"${version}"`, "Cache-Control": "private, no-cache" }
    if (etagMatches(request.headers.get("if-none-match"), version)) return new Response(null, { status: 304, headers })
    const body = scope === "mias"
      ? await buildCatalog(auth.context, version)
      : await buildOthersCatalog(auth.context.viewer, version)
    return Response.json(body, { headers })
  } catch (error) {
    return syncErrorResponse("catalogo", error)
  }
}
