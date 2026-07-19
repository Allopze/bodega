import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { readPreventionSensitiveFile } from "@/lib/services/prevention-sensitive-files"
import { encodeContentDisposition } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  const purpose = new URL(request.url).searchParams.get("purpose")?.trim()
  if (!purpose) return NextResponse.json({ error: "Propósito de acceso requerido" }, { status: 400 })
  const { id } = await context.params
  try {
    const file = await readPreventionSensitiveFile({
      fileId: id,
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
    return new Response(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": encodeContentDisposition(file.fileName, "attachment"),
        "Cache-Control": "private, max-age=0, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado o fuera de alcance" }, {
      status: 404,
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    })
  }
}
