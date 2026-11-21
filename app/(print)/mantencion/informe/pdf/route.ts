import { can, requireAnyPermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { PrintRenderError, printCredentialFromCookieHeader, renderPrintPageToPdf } from "@/lib/pdf/render-print-page"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { PRINT_DOCUMENT_SPECS } from "@/lib/pdf/print-specs"
import { encodeContentDisposition } from "@/lib/utils"
import { loadPanelReport, REPORT_PERMISSION } from "../report-data"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** El informe no tiene entidad: se imprime la hoja fija con la faena y el período en la query. */
const INFORME_SPEC = PRINT_DOCUMENT_SPECS.mantencion_informe

/**
 * PDF del Panel de mantención para la faena, el equipo y el período pedidos (`faena`, `equipo`, `desde`,
 * `hasta`). Exige exportar (`mant:export`) y poder leer el Panel; el alcance de faena lo aplican los mismos
 * cargadores que la pantalla (una faena o un equipo fuera de alcance se ignoran). Se imprime al vuelo y no se
 * archiva. Cada descarga queda en la bitácora.
 */
export async function GET(req: Request) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"], "/mantencion/panel")
  } catch {
    return new Response("No autorizado", { status: 403 })
  }
  if (!can(session, REPORT_PERMISSION)) return new Response("No autorizado", { status: 403 })

  const incoming = new URL(req.url).searchParams
  // Sólo se reenvían los cuatro filtros, que la página vuelve a validar contra el alcance.
  const forwarded = new URLSearchParams()
  for (const key of ["desde", "hasta", "faena", "equipo"]) {
    const value = incoming.get(key)
    if (value && value.length <= 64) forwarded.set(key, value)
  }

  // Resuelve nombre de archivo y alcance antes de montar un Chromium.
  const data = await loadPanelReport(session, Object.fromEntries(forwarded))

  let buffer: Buffer
  try {
    buffer = await renderPrintPageToPdf({
      origin: resolvePdfRenderOrigin(req),
      spec: INFORME_SPEC,
      entityId: "",
      query: forwarded.toString(),
      credential: printCredentialFromCookieHeader(req.headers.get("cookie")),
    })
  } catch (error) {
    if (error instanceof PrintRenderError) return new Response("No se pudo generar el informe", { status: 502 })
    throw error
  }

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "mant_panel_pdf",
    entityId: data.worksiteId ?? "todas",
    ...(data.worksiteId ? { worksiteId: data.worksiteId } : {}),
    newState: { from: data.period.from, to: data.period.to, equipmentId: data.equipment?.id ?? null, bytes: buffer.length },
  })

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(`${data.filenameBase}.pdf`, "attachment"),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
