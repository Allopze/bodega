export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { observationReplySchema } from "@/lib/mantencion/contracts"
import { replyObservation } from "@/lib/services/mantencion/record-lifecycle"
import { authenticateSyncRequest, syncErrorResponse, syncFailureResponse } from "@/lib/services/mantencion/sync-auth"
import { issueResponse, jsonResponse, readJsonBody } from "@/lib/services/mantencion/sync-http"

/**
 * POST /api/mantencion/sync/observaciones — el mecánico responde una observación
 * de su registro (regla 14). Sólo quien registró o ejecutó el trabajo, y una
 * vez; repetir la misma respuesta es idempotente. Autenticación: sólo Bearer.
 */
export async function POST(request: Request) {
  const auth = await authenticateSyncRequest(request, { pathname: new URL(request.url).pathname })
  if (!auth.ok) return syncFailureResponse(auth.failure)

  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = observationReplySchema.safeParse(body.body)
  if (!parsed.success) return issueResponse(parsed.error)

  try {
    const result = await replyObservation({
      observationId: parsed.data.observationId,
      response: parsed.data.response,
      userId: auth.context.viewer.userId,
    })
    if (result.ok) return jsonResponse({ ok: true, message: result.message ?? "Respuesta enviada." })
    return jsonResponse({ ok: false, code: "rejected", message: result.message, ...(result.field ? { field: result.field } : {}) }, 422)
  } catch (error) {
    return syncErrorResponse("observaciones", error)
  }
}
