import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { encodeContentDisposition } from "@/lib/utils"
import { withBrowserContext } from "@/lib/pdf/browser-pool"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { a4PdfOptions } from "@/lib/pdf/page-options"
import { getAssignmentById } from "@/lib/services/ti/assignments"
import { actaPdfFilename } from "../filename"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PDF server-side del acta de entrega/devolución. Renderiza la página print con
 * el pool headless de Chromium (mismo mecanismo que OC, guías y comprobantes).
 * La cookie de sesión se reenvía para que el navegador headless cargue la
 * página (y sus fotos, servidas por /api/ti/photos) como el usuario que pide.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  let session
  try {
    session = await requirePermission("ti:view")
  } catch {
    return new Response("No autorizado", { status: 403 })
  }

  const { assignmentId } = await params
  const assignment = await getAssignmentById(assignmentId)
  if (!assignment) return new Response("No encontrado", { status: 404 })
  if (!canAccessWorksite(session, assignment.worksiteId)) {
    return new Response("No encontrado", { status: 404 })
  }

  const origin = resolvePdfRenderOrigin(req)
  const printUrl = `${origin}/ti/actas/${assignmentId}/print`
  const cookie = req.headers.get("cookie") ?? ""

  const pdf = await withBrowserContext(
    { extraHTTPHeaders: cookie ? { cookie } : {} },
    async (ctx) => {
      const page = await ctx.newPage()
      await page.goto(printUrl, { waitUntil: "networkidle", timeout: 30_000 })
      return page.pdf(a4PdfOptions())
    },
  )

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(actaPdfFilename(assignment.code), "attachment"),
      "Cache-Control": "no-store",
    },
  })
}
