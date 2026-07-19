import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { executePreventionPrivacyRight } from "@/lib/services/prevention-privacy-rights"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext) {
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
    return NextResponse.json({ execution: { id: execution.id, outcome: execution.outcome } }, {
      status: 201,
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo ejecutar el derecho."
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "private, max-age=0, no-store" } })
  }
}
