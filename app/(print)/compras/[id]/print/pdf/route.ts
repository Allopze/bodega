import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { encodeContentDisposition } from "@/lib/utils"
import { withBrowserContext } from "@/lib/pdf/browser-pool"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { a4PdfOptions } from "@/lib/pdf/page-options"
import { ocPdfFilename } from "../filename"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Server-side PDF of the orden de compra. Renders the existing print page with
 * a pooled headless Chromium context, producing a clean A4 PDF without browser
 * chrome (date / URL / page number) — unlike window.print(). This lets the UI
 * offer a direct download instead of opening the browser print dialog.
 *
 * The session cookie is forwarded so the headless browser loads the page as
 * the requesting user. PDF_MAX_CONCURRENT (default 2) caps the number of
 * simultaneous Chromium contexts; further requests queue rather than spawning
 * additional browser processes.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session
  try {
    session = await requirePermission("purchasing:view")
  } catch {
    return new Response("No autorizado", { status: 403 })
  }

  const { id } = await params

  // Enforce access and get the code (for the filename) before touching the pool.
  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    columns: { id: true, code: true, worksiteId: true },
  })
  if (!order) return new Response("No encontrado", { status: 404 })
  if (!canAccessWorksite(session, order.worksiteId)) {
    return new Response("No encontrado", { status: 404 })
  }

  const origin = resolvePdfRenderOrigin(req)
  const printUrl = `${origin}/compras/${id}/print`
  const cookie = req.headers.get("cookie") ?? ""

  const pdf = await withBrowserContext(
    { extraHTTPHeaders: cookie ? { cookie } : {} },
    async (ctx) => {
      const page = await ctx.newPage()
      await page.goto(printUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
      // A4 con pie corrido numerado. Los márgenes salen de A4_MARGIN y son los
      // mismos que declara el @page de oc-print-styles.ts: la hoja no lleva
      // ancho ni padding propios, la caja de texto la define la página.
      return page.pdf(a4PdfOptions())
    },
  )

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(ocPdfFilename(order.code), "attachment"),
      "Cache-Control": "no-store",
    },
  })
}
