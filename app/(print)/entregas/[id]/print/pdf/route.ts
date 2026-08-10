import { eq } from "drizzle-orm"
import { db } from "@/db"
import { deliveries } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { encodeContentDisposition } from "@/lib/utils"
import { withBrowserContext } from "@/lib/pdf/browser-pool"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { a4PdfOptions } from "@/lib/pdf/page-options"

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

  const origin = resolvePdfRenderOrigin(req)
  const cookie = req.headers.get("cookie") ?? ""
  const pdf = await withBrowserContext(
    { extraHTTPHeaders: cookie ? { cookie } : {} },
    async (context) => {
      const page = await context.newPage()
      await page.goto(`${origin}/entregas/${id}/print`, { waitUntil: "domcontentloaded", timeout: 30_000 })
      // El comprobante tiene su propia caja (más angosta): debe coincidir con el
      // @page de delivery-print-styles.ts.
      return page.pdf(a4PdfOptions({ top: "12mm", right: "14mm", bottom: "20mm", left: "14mm" }))
    },
  )

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(`comprobante-entrega-${delivery.code}.pdf`, "attachment"),
      "Cache-Control": "no-store",
    },
  })
}
