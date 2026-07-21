export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { createPreventionHealthRecord } from "@/lib/services/prevention-health"

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:health:upload_clinical")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  let input: unknown
  try { input = await request.json() }
  catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }) }

  try {
    const record = await createPreventionHealthRecord({
      input,
      ctx: {
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    return NextResponse.json({ record }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear el registro de salud."
    const status = /llave de cifrado|dominio sensible está deshabilitado/i.test(message) ? 503 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
