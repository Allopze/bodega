export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPreventionHealthRestriction } from "@/lib/services/prevention-health"

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  const purpose = new URL(request.url).searchParams.get("purpose")?.trim()
  if (!purpose) return NextResponse.json({ error: "Propósito de acceso requerido" }, { status: 400 })
  const { id } = await context.params

  try {
    const restriction = await getPreventionHealthRestriction(id, {
      ctx: {
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
      purpose,
    })
    return NextResponse.json({ restriction })
  } catch {
    return NextResponse.json({ error: "Registro no encontrado o fuera de alcance" }, { status: 404 })
  }
}
