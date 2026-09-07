export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createPreventionPrivacyRequest,
  listPreventionPrivacyRequests,
} from "@/lib/services/prevention-privacy"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"

function requestContext(request: Request, user: { id: string; email?: string | null }) {
  return {
    userId: user.id,
    userEmail: user.email ?? undefined,
    ip: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  }
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!session.user.permissions.includes("prevention:privacy:manage_requests")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  const requests = await listPreventionPrivacyRequests(resolveWorksiteScope(session))
  return NextResponse.json({ requests }, {
    headers: { "Cache-Control": "private, max-age=0, no-store" },
  })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!session.user.permissions.includes("prevention:privacy:manage_requests")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  let input: unknown
  try { input = await request.json() }
  catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }) }

  try {
    const privacyRequest = await createPreventionPrivacyRequest({
      input,
      ctx: requestContext(request, session.user),
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    return NextResponse.json({ privacyRequest }, {
      status: 201,
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    })
  } catch (error) {
    logger.error("[prevencion/privacidad/solicitudes]", error)
    const message = safeActionMessage(error, "No se pudo crear la solicitud.")
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
