import { eq } from "drizzle-orm"
import { db } from "@/db"
import { dispatchGuides } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { encodeContentDisposition } from "@/lib/utils"
import { withBrowserContext } from "@/lib/pdf/browser-pool"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { a4PdfOptions } from "@/lib/pdf/page-options"
import { guidePdfFilename } from "../filename"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Renderiza la hoja A4 de la guía (misma ruta con control de acceso) como PDF.
 * El PDF se regenera en cada descarga desde la BD: la base es la fuente de
 * verdad y una guía anulada o recibida después sale reflejada al instante.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requirePermission("warehouse:view_guides")
  } catch {
    return new Response("No autorizado", { status: 403 })
  }

  const { id } = await params
  const guide = await db.query.dispatchGuides.findFirst({
    where: eq(dispatchGuides.id, id),
    columns: { id: true, code: true, destinationWorksiteId: true },
  })
  if (!guide || !canAccessWorksite(session, guide.destinationWorksiteId)) {
    return new Response("No encontrado", { status: 404 })
  }

  const origin = resolvePdfRenderOrigin(req)
  const cookie = req.headers.get("cookie") ?? ""
  const pdf = await withBrowserContext(
    { extraHTTPHeaders: cookie ? { cookie } : {} },
    async (context) => {
      const page = await context.newPage()
      await page.goto(`${origin}/bodega/guias/${id}/print`, { waitUntil: "domcontentloaded", timeout: 30_000 })
      // Debe coincidir con el @page de guide-print-styles.ts.
      return page.pdf(a4PdfOptions())
    },
  )

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(guidePdfFilename(guide.code), "attachment"),
      "Cache-Control": "no-store",
    },
  })
}
