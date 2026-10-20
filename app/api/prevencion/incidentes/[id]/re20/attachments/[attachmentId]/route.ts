import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { encodeContentDisposition } from "@/lib/utils"
import { getPreventionIncidentRe20Attachment } from "@/lib/services/prevention-incident-re20-attachments"
import { trustedAuditIp } from "@/lib/security/login-rate-limit-ip"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  let session
  try { session = await requirePermission("prevention:incidents:view") }
  catch { return new Response("No autorizado", { status: 403 }) }
  const { id, attachmentId } = await params
  const purpose = new URL(request.url).searchParams.get("purpose") ?? ""
  try {
    const result = await getPreventionIncidentRe20Attachment({
      incidentId: id,
      attachmentId,
      purpose,
      access: {
        ctx: { userId: session.user.id, ip: trustedAuditIp(request.headers), userAgent: request.headers.get("user-agent") ?? undefined },
        scope: resolveWorksiteScope(session),
        permissions: session.user.permissions,
        roles: session.user.roles ?? [],
      },
    })
    return new Response(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": result.metadata.mimeType,
        "Content-Disposition": encodeContentDisposition(result.metadata.fileName, "attachment"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-RE20-SHA256": result.checksumSha256,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo abrir el anexo RE-20."
    return new Response(message, { status: /no encontrado/i.test(message) ? 404 : 403 })
  }
}
