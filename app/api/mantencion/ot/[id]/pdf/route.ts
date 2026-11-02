import { requireAnyPermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { PrintRenderError, printCredentialFromCookieHeader, renderPrintPageToPdf } from "@/lib/pdf/render-print-page"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { PRINT_DOCUMENT_SPECS } from "@/lib/pdf/print-specs"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { loadWorkOrderDetail } from "@/lib/services/mantencion/work-orders/query"
import { encodeContentDisposition } from "@/lib/utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Descarga el PDF de una OT. Exige visibilidad de OT (`mant:ot:view_*`, NO
 * `mant:export`: el administrador de contrato no exporta registros pero sí
 * imprime las órdenes de su faena) y alcance sobre la orden: `loadWorkOrderDetail`
 * responde `null` tanto para «no existe» como para «no es tuya», y aquí ambos son
 * el mismo 404.
 *
 * A diferencia del PDF de un registro firmado, éste se imprime AL VUELO cada vez
 * y no se archiva: la OT cambia (ingreso, salida, recepciones) y un PDF guardado
 * mostraría un estado viejo. Cada descarga queda en la bitácora.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:ot:view_worksite", "mant:ot:view_all"], "/mantencion/ot")
  } catch {
    return new Response("No autorizado", { status: 403 })
  }

  const { id } = await params
  const detail = await loadWorkOrderDetail(viewerFromSession(session), id)
  if (!detail) return new Response("Orden de trabajo no encontrada", { status: 404 })

  let buffer: Buffer
  try {
    buffer = await renderPrintPageToPdf({
      origin: resolvePdfRenderOrigin(req),
      spec: PRINT_DOCUMENT_SPECS.mantencion_ot,
      entityId: detail.id,
      credential: printCredentialFromCookieHeader(req.headers.get("cookie")),
    })
  } catch (error) {
    if (error instanceof PrintRenderError) return new Response("No se pudo generar el PDF de la orden", { status: 502 })
    throw error
  }

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "mant_work_order_pdf",
    entityId: detail.id,
    entityCode: detail.folio,
    worksiteId: detail.worksiteId,
    newState: { status: detail.status, version: detail.version, bytes: buffer.length },
  })

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(`orden-de-trabajo-${detail.folio}.pdf`, "attachment"),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
