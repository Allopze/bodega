import { requirePermission } from "@/lib/auth/can"
import { encodeContentDisposition } from "@/lib/utils"
import { loadActaData } from "../document"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Server-side PDF of the acta SST. Renders the existing print page with headless
 * Chromium and prints it, producing a clean A4 PDF with no browser chrome
 * (date / URL / page number) — unlike window.print(). The session cookie is
 * forwarded so the headless browser loads the page as the requesting user.
 *
 * playwright is imported lazily (inside the handler) so that playwright-core's
 * module-level initialisation (which requires browsers.json) does not run at
 * Next.js server startup — only when this route is actually requested.
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

  // Enforce access and obtain the suggested filename up front (also avoids
  // launching a browser for an evaluation the user can't see).
  const data = await loadActaData(id, session)
  if (!data) return new Response("No encontrado", { status: 404 })

  const origin = process.env.APP_URL ?? new URL(req.url).origin
  const printUrl = `${origin}/sst/${id}/print`
  const cookie = req.headers.get("cookie") ?? ""

  // Lazy import: keeps playwright-core out of the module graph at startup.
  const { chromium } = await import("playwright")
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ extraHTTPHeaders: cookie ? { cookie } : {} })
    const page = await ctx.newPage()
    await page.goto(printUrl, { waitUntil: "networkidle" })
    // page.pdf() applies print media automatically, so the toolbar is hidden
    // and the @media print rules (block layout, no margins) take effect.
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    })

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": encodeContentDisposition(data.suggestedFilename, "attachment"),
        "Cache-Control": "no-store",
      },
    })
  } finally {
    await browser.close()
  }
}
