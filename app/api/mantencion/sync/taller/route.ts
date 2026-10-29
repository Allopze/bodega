export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { workshopUpdateSchema } from "@/lib/mantencion/contracts"
import { authenticateSyncRequest, syncErrorResponse, syncFailureResponse } from "@/lib/services/mantencion/sync-auth"
import { issueResponse, jsonResponse, readJsonBody } from "@/lib/services/mantencion/sync-http"
import { applyWorkshopUpdate } from "@/lib/services/mantencion/workshop-updates"

/**
 * POST /api/mantencion/sync/taller — «Sigue en taller» o «Ya salió», idempotente
 * por `id`. Autenticación: sólo `Authorization: Bearer`.
 */
export async function POST(request: Request) {
  const auth = await authenticateSyncRequest(request, { pathname: new URL(request.url).pathname })
  if (!auth.ok) return syncFailureResponse(auth.failure)

  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = workshopUpdateSchema.safeParse(body.body)
  if (!parsed.success) return issueResponse(parsed.error)

  try {
    const outcome = await applyWorkshopUpdate(parsed.data, auth.context)
    return jsonResponse(outcome.body, outcome.status)
  } catch (error) {
    return syncErrorResponse("taller", error)
  }
}
