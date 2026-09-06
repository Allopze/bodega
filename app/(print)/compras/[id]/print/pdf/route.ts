import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { requireAuth, can, canAny, canAccessWorksite } from "@/lib/auth/can"
import { encodeContentDisposition } from "@/lib/utils"
import { withBrowserContext } from "@/lib/pdf/browser-pool"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"
import { a4PdfOptions } from "@/lib/pdf/page-options"
import { parsePdfEngine, resolvePdfEngine } from "@/lib/pdf/engines"
import { getPdfEngineFor } from "@/lib/services/system-settings"
import { ocPdfFilename } from "../filename"
import { loadOcPrintDataOrNull } from "../oc-print-data"
import { renderOcPdf } from "../oc-pdfcn-render"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PDF de la orden de compra. Hay dos motores y el que se use lo decide el ajuste
 * de administración (`pdf.engine.oc`), con un override por query string para
 * poder comparar los dos sin cambiar el estado global mientras otros trabajan.
 *
 * - `chromium`: renderiza la página de impresión existente con un contexto
 *   headless del pool, produciendo un A4 limpio sin el cromo del navegador
 *   (fecha / URL / numeración) que añadiría `window.print()`. Se reenvía la
 *   cookie de sesión para que el navegador cargue la página como el usuario que
 *   pide el PDF. `PDF_MAX_CONCURRENT` (2 por defecto) limita los contextos
 *   simultáneos; el resto hace cola en vez de abrir más procesos.
 * - `pdfcn`: compone el documento con Takumi dentro de este proceso, sin
 *   navegador ni petición HTTP a sí mismo.
 */
function pdfResponse(pdf: Uint8Array, filename: string): Response {
  // Copia a un buffer propio, como en `app/api/purchase-orders/dtes/[id]/pdf`:
  // `Uint8Array<ArrayBufferLike>` no satisface `BodyInit`.
  const body = Uint8Array.from(pdf)
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": encodeContentDisposition(filename, "attachment"),
      "Cache-Control": "no-store",
    },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Mismo gate que el detalle y la página de impresión que este PDF renderiza.
  let session
  try {
    session = await requireAuth()
  } catch {
    return new Response("No autorizado", { status: 403 })
  }
  if (!canAny(session, "purchasing:view", "receiving:view")) {
    return new Response("No autorizado", { status: 403 })
  }

  const { id } = await params

  // El override es una herramienta de administración: quien puede cambiar el
  // ajuste puede saltárselo puntualmente. Para el resto se ignora en silencio,
  // no se rechaza la petición: el PDF sigue saliendo con el motor configurado.
  const override = can(session, "admin:ops_settings")
    ? parsePdfEngine("oc", new URL(req.url).searchParams.get("motor"))
    : null

  const engine = resolvePdfEngine("oc", {
    override,
    configured: await getPdfEngineFor("oc"),
  })

  if (engine === "pdfcn") {
    const data = await loadOcPrintDataOrNull(id, session)
    if (!data) return new Response("No encontrado", { status: 404 })
    return pdfResponse(await renderOcPdf(data), data.suggestedFilename)
  }

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

  return pdfResponse(pdf, ocPdfFilename(order.code))
}
