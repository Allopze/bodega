import { requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { printCredentialFromCookieHeader } from "@/lib/pdf/render-print-page"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { getRecordPdf } from "@/lib/services/mantencion/record-pdf"
import { encodeContentDisposition } from "@/lib/utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Descarga el PDF de un registro firmado. Exige `mant:export` Y alcance sobre el
 * registro (`getRecordPdf` responde el mismo 404 para «no existe» y «no es
 * tuyo»). La primera descarga lo genera y lo archiva; las siguientes entregan el
 * mismo archivo. Cada descarga queda en la bitácora.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requirePermission("mant:export")
  } catch {
    return new Response("No autorizado", { status: 403 })
  }

  const { id } = await params
  const result = await getRecordPdf({
    viewer: viewerFromSession(session),
    recordId: id,
    origin: resolvePdfRenderOrigin(req),
    credential: printCredentialFromCookieHeader(req.headers.get("cookie")),
  })
  if (!result.ok) return new Response(result.message, { status: result.status })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "mant_record_pdf",
    entityId: result.recordId,
    entityCode: result.folio ?? undefined,
    worksiteId: result.worksiteId,
    newState: { generated: result.generated, bytes: result.buffer.length },
  })

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(result.filename, "attachment"),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
