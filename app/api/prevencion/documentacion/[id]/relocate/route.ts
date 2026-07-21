import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { relocateGeneralDocumentToSensitiveDomain } from "@/lib/services/prevention-sensitive-files"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface RouteContext { params: Promise<{ id: string }> }

const sensitiveRelocateSchema = z.object({
  targetDomain: z.enum(["health", "reserved_case"]),
  targetEntityId: z.string().min(1),
  reason: z.string().min(10),
  versionId: z.string().optional(),
})

export async function POST(request: Request, context: RouteContext) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:docs:publish") || !can(session, "prevention:docs:manage_sensitive")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 }) }

  const parsed = sensitiveRelocateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Cuerpo inválido", details: parsed.error.flatten() }, { status: 400 })
  }
  const { id } = await context.params
  try {
    const relocation = await relocateGeneralDocumentToSensitiveDomain({
      documentId: id,
      versionId: parsed.data.versionId ?? "",
      targetDomain: parsed.data.targetDomain,
      targetEntityId: parsed.data.targetEntityId,
      reason: parsed.data.reason,
      ctx: {
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    return NextResponse.json({ relocation }, { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo reubicar el expediente."
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "private, no-store" } })
  }
}
