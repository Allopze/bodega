export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { workOrderOpSchema } from "@/lib/mantencion/contracts"
import { authenticateSyncRequest, syncErrorResponse, syncFailureResponse } from "@/lib/services/mantencion/sync-auth"
import { issueResponse, jsonResponse, readJsonBody } from "@/lib/services/mantencion/sync-http"
import { applyWorkOrderOp } from "@/lib/services/mantencion/work-orders/sync-ops"

/**
 * POST /api/mantencion/sync/ot — operación del mecánico sobre una orden de
 * trabajo (tomar, ingreso, fecha estimada, ítems SÍ/NO, terminar), idempotente
 * por `id`. Autenticación: sólo `Authorization: Bearer`; exige `mant:ot:execute`.
 */
export async function POST(request: Request) {
  const auth = await authenticateSyncRequest(request, { pathname: new URL(request.url).pathname })
  if (!auth.ok) return syncFailureResponse(auth.failure)

  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = workOrderOpSchema.safeParse(body.body)
  if (!parsed.success) return issueResponse(parsed.error)

  try {
    const outcome = await applyWorkOrderOp(parsed.data, auth.context)
    return jsonResponse(outcome.body, outcome.status)
  } catch (error) {
    return syncErrorResponse("ot", error)
  }
}
