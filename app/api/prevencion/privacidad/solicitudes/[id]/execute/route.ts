import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { executePreventionPrivacyRight } from "@/lib/services/prevention-privacy-rights"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext) {
  const idempotencyKey = request.headers.get("idempotency-key")
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 64) {
    return NextResponse.json({ error: "Se requiere el header Idempotency-Key (8-64 caracteres)" }, { status: 400 })
  }

  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!session.user.permissions.includes("prevention:privacy:manage_requests")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }) }
  const { id } = await context.params

  // La idempotencia vive en `prevention_privacy_request_executions`
  // (`executePreventionPrivacyRight`), namespaceada por solicitud y actor, y se
  // resuelve después de autenticar y autorizar. Antes era un `Map` de este
  // proceso: un reinicio o una segunda instancia la perdían y el mismo envío
  // podía ejecutar dos veces un derecho irreversible.
  try {
    const execution = await executePreventionPrivacyRight({
      input: { ...body, requestId: id },
      ctx: {
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
      idempotencyKey,
    })
    const result = { execution: { id: execution.id, outcome: execution.outcome } }
    return NextResponse.json(result, {
      status: execution.replayed ? 200 : 201,
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    })
  } catch (error) {
    logger.error("[prevencion/privacidad/solicitudes/id/execute]", error)
    const message = safeActionMessage(error, "No se pudo ejecutar el derecho.")
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "private, max-age=0, no-store" } })
  }
}
