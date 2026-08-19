import { requirePermission } from "@/lib/auth/can"
import { encodeContentDisposition } from "@/lib/utils"
import { loadInspectionActaData } from "../document"
import { withBrowserContext } from "@/lib/pdf/browser-pool"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { a4PdfOptions } from "@/lib/pdf/page-options"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PDF del acta de una inspección, renderizado server-side con el pool de
 * Chromium (mismo pipeline que la acta SST y las guías de despacho).
 *
 * La cookie de sesión se reenvía para que el navegador headless cargue la
 * página como el usuario que pide el PDF.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  let session
  try {
    session = await requirePermission("prevention:inspections:view")
  } catch {
    return new Response("No autorizado", { status: 403 })
  }

  const { runId } = await params

  // El alcance de faena se comprueba antes de tocar el pool: montar un Chromium
  // para descubrir después que no había acceso es caro y evitable.
  const data = await loadInspectionActaData(runId, session)
  if (!data) return new Response("No encontrado", { status: 404 })

  const origin = resolvePdfRenderOrigin(req)
  const printUrl = `${origin}/prevencion/inspecciones/${runId}/print`
  const cookie = req.headers.get("cookie") ?? ""

  const pdf = await withBrowserContext(
    { extraHTTPHeaders: cookie ? { cookie } : {} },
    async (ctx) => {
      const page = await ctx.newPage()
      await page.goto(printUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
      // El acta puede traer miniaturas de evidencia servidas por HTTP: con
      // `domcontentloaded` a secas el PDF sale antes de que carguen y las
      // imágenes aparecen en blanco.
      await page.waitForFunction(
        () => Array.from(document.images).every((image) => image.complete),
        undefined,
        { timeout: 15_000 },
      ).catch(() => {
        // Una imagen que no carga no puede impedir emitir el acta.
      })
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
