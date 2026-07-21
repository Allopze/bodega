export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildPreventionPrivacySubjectExport } from "@/lib/services/prevention-privacy-export"

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!session.user.permissions.includes("prevention:privacy:export_subject")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  const search = new URL(request.url).searchParams
  const purpose = search.get("purpose")?.trim()
  if (!purpose) return NextResponse.json({ error: "Propósito de exportación requerido" }, { status: 400 })
  const includeClinical = search.get("includeClinical") === "1"
  const { id } = await context.params

  try {
    const result = await buildPreventionPrivacySubjectExport({
      requestId: id,
      includeClinical,
      purpose,
      ctx: {
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    return new Response(result.bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="privacidad-${result.requestId}.xlsx"`,
        "Cache-Control": "private, max-age=0, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Privacy-Export-Checksum": result.checksumSha256,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo preparar la exportación."
    const status = /llave de cifrado|dominio sensible está deshabilitado/i.test(message)
      ? 503
      : /no encontrada o fuera de alcance/i.test(message)
        ? 404
        : 409
    return NextResponse.json({ error: message }, { status })
  }
}
