import { requirePermission } from "@/lib/auth/can"
import { encodeContentDisposition } from "@/lib/utils"
import { loadActaData } from "../document"
import { withBrowserContext } from "@/lib/pdf/browser-pool"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { a4PdfOptions } from "@/lib/pdf/page-options"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Server-side PDF of the acta SST. Renders the existing print page with a
 * pooled headless Chromium context, producing a clean A4 PDF without browser
 * chrome (date / URL / page number) — unlike window.print().
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
    session = await requirePermission("sst:view")
  } catch {
    return new Response("No autorizado", { status: 403 })
  }

  const { id } = await params

  // Enforce access and get the filename before touching the browser pool.
  const data = await loadActaData(id, session)
  if (!data) return new Response("No encontrado", { status: 404 })

  const origin = resolvePdfRenderOrigin(req)
  const printUrl = `${origin}/sst/${id}/print`
  const cookie = req.headers.get("cookie") ?? ""

  const pdf = await withBrowserContext(
    { extraHTTPHeaders: cookie ? { cookie } : {} },
    async (ctx) => {
      const page = await ctx.newPage()
      await page.goto(printUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
      // Márgenes idénticos al @page de acta-styles.ts; el pie numera las hojas.
      return page.pdf(a4PdfOptions())
    },
  )

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(data.suggestedFilename, "attachment"),
      "Cache-Control": "no-store",
    },
  })
}
