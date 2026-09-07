export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { transitionPreventionPrivacyRequest } from "@/lib/services/prevention-privacy"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"

interface RouteContext { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!session.user.permissions.includes("prevention:privacy:manage_requests")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }) }
  const { id } = await context.params

  try {
    const privacyRequest = await transitionPreventionPrivacyRequest({
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
    return NextResponse.json({ privacyRequest }, {
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    })
  } catch (error) {
    logger.error("[prevencion/privacidad/solicitudes/id]", error)
    const rawMessage = error instanceof Error ? error.message : "No se pudo actualizar la solicitud."
    const status = /no encontrada o fuera de alcance/i.test(rawMessage) ? 404 : 409
    return NextResponse.json({ error: safeActionMessage(error, "No se pudo actualizar la solicitud.") }, { status })
  }
}
