import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { encodeContentDisposition } from "@/lib/utils"
import { getPreventionIncidentDetail } from "@/lib/services/prevention-incidents"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { PRINT_DOCUMENT_SPECS } from "@/lib/pdf/print-specs"
import { PrintRenderError, printCredentialFromCookieHeader, renderPrintPageToPdf } from "@/lib/pdf/render-print-page"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("prevention:incidents:view") }
  catch { return new Response("No autorizado", { status: 403 }) }
  const { id } = await params
  const url = new URL(req.url)
  const includeSensitive = url.searchParams.get("sensitive") === "1"
  const purpose = url.searchParams.get("purpose")?.trim() ?? ""
  if (includeSensitive && (purpose.length < 3 || purpose.length > 300)) {
    return new Response("Propósito de acceso sensible inválido", { status: 400 })
  }
  if (includeSensitive && !can(session, "prevention:incidents:view_sensitive")) {
    return new Response("No autorizado", { status: 403 })
  }
  const detail = await getPreventionIncidentDetail({
    incidentId: id,
    access: { ctx: { userId: session.user.id }, scope: resolveWorksiteScope(session), permissions: session.user.permissions },
    includeSensitive: false,
  })
  if (!detail) return new Response("No encontrado", { status: 404 })
  const sensitiveQuery = includeSensitive
    ? new URLSearchParams({ sensitive: "1", purpose }).toString()
    : undefined
  try {
    const pdf = await renderPrintPageToPdf({
      origin: resolvePdfRenderOrigin(req),
      spec: PRINT_DOCUMENT_SPECS.re20,
      entityId: id,
      query: sensitiveQuery,
      credential: printCredentialFromCookieHeader(req.headers.get("cookie")),
    })
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": encodeContentDisposition(`${detail.incident.code}-RE-20${includeSensitive ? "-reservado" : ""}.pdf`, "attachment"),
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof PrintRenderError && error.code === "RENDER_UNAUTHORIZED") return new Response("No autorizado", { status: 403 })
    if (error instanceof PrintRenderError) return new Response("No se pudo generar el PDF", { status: 502 })
    throw error
  }
}
