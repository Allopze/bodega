import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { encodeContentDisposition } from "@/lib/utils"
import { withBrowserContext } from "@/lib/pdf/browser-pool"
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

  const origin = process.env.APP_URL ?? new URL(req.url).origin
  const printUrl = `${origin}/compras/${id}/print`
  const cookie = req.headers.get("cookie") ?? ""

  const pdf = await withBrowserContext(
    { extraHTTPHeaders: cookie ? { cookie } : {} },
    async (ctx) => {
      const page = await ctx.newPage()
      await page.goto(printUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
      // Generate A4 PDF.  The @page CSS sets 12mm page margins; the sheet is
      // 186mm wide (210mm − 24mm) in print media, so it fits exactly inside
      // the content area — no right-side clipping, no content flush to edges.
      return page.pdf({
        printBackground: true,
        format: "A4",
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      })
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
