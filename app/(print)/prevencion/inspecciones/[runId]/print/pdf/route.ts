import { requirePermission } from "@/lib/auth/can"
import { encodeContentDisposition } from "@/lib/utils"
import { loadInspectionActaData } from "../document"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { PRINT_DOCUMENT_SPECS } from "@/lib/pdf/print-specs"
import { PrintRenderError, printCredentialFromCookieHeader, renderPrintPageToPdf } from "@/lib/pdf/render-print-page"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PDF del acta de una inspección, renderizado server-side con el pool de
 * Chromium (mismo pipeline que la acta SST y las guías de despacho).
 *
 * La cookie de sesión se reenvía (solo a la propia plataforma) para que el
 * navegador headless cargue la página como el usuario que pide el PDF.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  let session
  try {
    session = await requirePermission("prevention:inspections:view")
  } catch {
    return new Response("No autorizado", { status: 403 })
  }

  const { runId } = await params

  // El alcance de faena se comprueba antes de tocar el pool: montar un Chromium
  // para descubrir después que no había acceso es caro y evitable.
  const data = await loadInspectionActaData(runId, session)
  if (!data) return new Response("No encontrado", { status: 404 })

  // La espera de imágenes y los márgenes viven en la especificación compartida
  // con el archivado de documentos generados.
  let pdf: Buffer
  try {
    pdf = await renderPrintPageToPdf({
      origin: resolvePdfRenderOrigin(req),
      spec: PRINT_DOCUMENT_SPECS.inspeccion,
      entityId: runId,
      credential: printCredentialFromCookieHeader(req.headers.get("cookie")),
    })
  } catch (error) {
    if (error instanceof PrintRenderError) return new Response("No se pudo generar el acta", { status: 502 })
    throw error
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(data.suggestedFilename, "attachment"),
      "Cache-Control": "no-store",
    },
  })
}
