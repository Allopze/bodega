export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { syncRecordSchema } from "@/lib/mantencion/contracts"
import { createRecord } from "@/lib/services/mantencion/records-create"
import { authenticateSyncRequest, syncErrorResponse, syncFailureResponse } from "@/lib/services/mantencion/sync-auth"
import { issueResponse, jsonResponse, readJsonBody } from "@/lib/services/mantencion/sync-http"

/**
 * POST /api/mantencion/sync/registros — recibe un registro firmado (preventiva
 * o correctiva). Idempotente por `id`, revalida en el servidor todo el §8 y
 * asigna el folio. Autenticación: sólo `Authorization: Bearer`. La lógica vive
 * en `lib/services/mantencion/records-create*.ts`.
 */
export async function POST(request: Request) {
  const auth = await authenticateSyncRequest(request, { pathname: new URL(request.url).pathname })
  if (!auth.ok) return syncFailureResponse(auth.failure)

  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = syncRecordSchema.safeParse(body.body)
  if (!parsed.success) return issueResponse(parsed.error)

  try {
    const outcome = await createRecord(parsed.data, auth.context)
    return jsonResponse(outcome.body, outcome.status)
  } catch (error) {
    return syncErrorResponse("registros", error)
  }
}
