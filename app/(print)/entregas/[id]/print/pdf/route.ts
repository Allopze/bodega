import { eq } from "drizzle-orm"
import { db } from "@/db"
import { deliveries } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { encodeContentDisposition } from "@/lib/utils"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { PRINT_DOCUMENT_SPECS } from "@/lib/pdf/print-specs"
import { PrintRenderError, printCredentialFromCookieHeader, renderPrintPageToPdf } from "@/lib/pdf/render-print-page"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Renders the existing access-controlled delivery preview as a clean A4 PDF. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requirePermission("deliveries:view")
  } catch {
    return new Response("No autorizado", { status: 403 })
  }

  const { id } = await params
  const delivery = await db.query.deliveries.findFirst({
    where: eq(deliveries.id, id),
    columns: { id: true, code: true, worksiteId: true },
  })
  if (!delivery || !delivery.worksiteId || !canAccessWorksite(session, delivery.worksiteId)) {
    return new Response("No encontrado", { status: 404 })
  }

  let pdf: Buffer
  try {
    pdf = await renderPrintPageToPdf({
      origin: resolvePdfRenderOrigin(req),
      spec: PRINT_DOCUMENT_SPECS.entrega,
      entityId: id,
      credential: printCredentialFromCookieHeader(req.headers.get("cookie")),
    })
  } catch (error) {
    if (error instanceof PrintRenderError) return new Response("No se pudo generar el comprobante", { status: 502 })
    throw error
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(`comprobante-entrega-${delivery.code}.pdf`, "attachment"),
      "Cache-Control": "no-store",
    },
  })
}
