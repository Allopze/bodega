import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { storePreventionIncidentRe20Attachment } from "@/lib/services/prevention-incident-re20-attachments"
import { trustedAuditIp } from "@/lib/security/login-rate-limit-ip"
import { RE20_ATTACHMENT_ACCEPT_MESSAGE, RE20_ATTACHMENT_LIMITS } from "@/lib/prevention/re20-attachment-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set(RE20_ATTACHMENT_LIMITS.allowedMimeTypes)

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("prevention:incidents:investigate") }
  catch { return Response.json({ ok: false, message: "No autorizado." }, { status: 403 }) }
  const { id } = await params
  let form: FormData
  try { form = await request.formData() }
  catch { return Response.json({ ok: false, message: "Formulario de anexo inválido." }, { status: 400 }) }
  const file = form.get("file")
  if (!(file instanceof File) || !file.size || file.size > RE20_ATTACHMENT_LIMITS.maxFileBytes || !ALLOWED_MIME_TYPES.has(file.type)) {
    return Response.json({ ok: false, message: RE20_ATTACHMENT_ACCEPT_MESSAGE }, { status: 400 })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const result = await storePreventionIncidentRe20Attachment({
      input: {
        incidentId: id,
        clientAttachmentId: form.get("clientAttachmentId"),
        expectedWorkspaceVersion: Number(form.get("expectedWorkspaceVersion")),
        purpose: form.get("purpose"),
        fileName: file.name,
        mimeType: file.type,
      },
      bytes,
      access: {
        ctx: { userId: session.user.id, ip: trustedAuditIp(request.headers), userAgent: request.headers.get("user-agent") ?? undefined },
        scope: resolveWorksiteScope(session),
        permissions: session.user.permissions,
        roles: session.user.roles ?? [],
      },
    })
    return Response.json({ ok: true, ...result })
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "No se pudo guardar el anexo." }, { status: 400 })
  }
}
