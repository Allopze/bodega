export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { createPreventionReservedCase } from "@/lib/services/prevention-reserved-cases"

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!session.user.permissions.includes("prevention:reserved_case:investigate")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  let input: unknown
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }

  try {
    const reservedCase = await createPreventionReservedCase({
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
    return NextResponse.json({ reservedCase }, {
      status: 201,
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear el caso reservado."
    const status = /llave de cifrado|dominio sensible está deshabilitado/i.test(message) ? 503 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
