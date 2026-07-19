export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPreventionReservedCase } from "@/lib/services/prevention-reserved-cases"

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  const purpose = new URL(request.url).searchParams.get("purpose")?.trim()
  if (!purpose) return NextResponse.json({ error: "Propósito de acceso requerido" }, { status: 400 })
  const { id } = await context.params

  try {
    const reservedCase = await getPreventionReservedCase({
      caseId: id,
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
    return NextResponse.json({ reservedCase }, {
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    })
  } catch {
    // Misma respuesta para inexistencia, faena ajena, falta de permiso o de
    // membresía: el endpoint no permite inferir que el expediente existe.
    return NextResponse.json({ error: "Caso no encontrado o fuera de alcance" }, { status: 404 })
  }
}
