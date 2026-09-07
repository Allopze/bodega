import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { executePreventionPrivacyRight } from "@/lib/services/prevention-privacy-rights"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface RouteContext { params: Promise<{ id: string }> }

const idempotencyCache = new Map<string, { result: unknown; timestamp: number }>()
const IDEMPOTENCY_TTL_MS = 86_400_000 // 24 horas

export async function POST(request: Request, context: RouteContext) {
  const idempotencyKey = request.headers.get("idempotency-key")
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 64) {
    return NextResponse.json({ error: "Se requiere el header Idempotency-Key (8-64 caracteres)" }, { status: 400 })
  }

  // La caché se consulta DESPUÉS de autenticar y autorizar: antes, un no
  // autenticado que adivinara u observara una clave recibía el resultado
  // cacheado sin pasar por `auth()`.
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!session.user.permissions.includes("prevention:privacy:manage_requests")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }) }
  const { id } = await context.params

  // La clave se namespacea por usuario y solicitud: sin eso, reutilizar la misma
  // `Idempotency-Key` en OTRA solicitud devolvía el resultado de la primera y la
  // segunda ejecución del derecho se omitía en silencio.
  const cacheKey = `${session.user.id}:${id}:${idempotencyKey}`
  const cached = idempotencyCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < IDEMPOTENCY_TTL_MS) {
    return NextResponse.json(cached.result, {
      status: 200,
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    })
  }

  // Limpiar entradas expiradas periódicamente
  for (const [key, value] of idempotencyCache) {
    if (Date.now() - value.timestamp > IDEMPOTENCY_TTL_MS) idempotencyCache.delete(key)
  }
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
    })
    const result = { execution: { id: execution.id, outcome: execution.outcome } }
    idempotencyCache.set(cacheKey, { result, timestamp: Date.now() })
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    })
  } catch (error) {
    logger.error("[prevencion/privacidad/solicitudes/id/execute]", error)
    const message = safeActionMessage(error, "No se pudo ejecutar el derecho.")
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "private, max-age=0, no-store" } })
  }
}
