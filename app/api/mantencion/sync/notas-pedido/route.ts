export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { partsNoteSchema } from "@/lib/mantencion/contracts"
import { createPartsNoteFromDevice } from "@/lib/services/mantencion/parts-notes/create"
import { authenticateSyncRequest, syncErrorResponse, syncFailureResponse } from "@/lib/services/mantencion/sync-auth"
import { issueResponse, jsonResponse, readJsonBody } from "@/lib/services/mantencion/sync-http"

/**
 * POST /api/mantencion/sync/notas-pedido — el mecánico pide repuestos para una OT
 * asignada (nota de pedido, ADR mantención 0001). Idempotente por `id`: la misma NP
 * enviada tres veces deja una. Autenticación: sólo `Authorization: Bearer`.
 */
export async function POST(request: Request) {
  const auth = await authenticateSyncRequest(request, { pathname: new URL(request.url).pathname })
  if (!auth.ok) return syncFailureResponse(auth.failure)

  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = partsNoteSchema.safeParse(body.body)
  if (!parsed.success) return issueResponse(parsed.error)

  try {
    const outcome = await createPartsNoteFromDevice(parsed.data, auth.context)
    return jsonResponse(outcome.body, outcome.status)
  } catch (error) {
    return syncErrorResponse("notas-pedido", error)
  }
}
