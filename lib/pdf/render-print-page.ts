/**
 * Imprime una página de `app/(print)` a PDF con el pool de Chromium.
 *
 * Lo usan las rutas de descarga y el archivado de documentos generados, para
 * que ambos saquen el mismo PDF. Tres defensas que las rutas no tenían:
 *
 * - La cookie de sesión va solo a la propia plataforma. `extraHTTPHeaders` la
 *   pone en CADA petición de la página, también a un host ajeno: el comprobante
 *   de entrega carga el pictograma de cada familia de EPP desde una URL
 *   absoluta guardada en la base. Las peticiones a otro origen se rehacen sin
 *   la cookie. No sirven las alternativas obvias: Chromium ignora una cookie
 *   inyectada con `route.continue({ headers })` (la página cae en /login), y
 *   rechaza con `addCookies` una cookie `__Secure-` sobre http://127.0.0.1,
 *   que es justo como se llama la sesión en producción.
 * - Una página que terminó en /login, /forbidden o /modulo-inactivo, o que no
 *   trae la marca `data-print-ready`, no es el documento: se rechaza en vez de
 *   convertirla en un PDF que parece válido.
 * - El resultado tiene que empezar con `%PDF`.
 */
import type { Route } from "playwright"
import { withBrowserContext } from "./browser-pool"
import { PRINT_READY_ATTRIBUTE, printPdfOptions, type PrintDocumentSpec } from "./print-specs"

export type PrintRenderErrorCode = "RENDER_UNAUTHORIZED" | "RENDER_FAILED" | "INVALID_OUTPUT"

export class PrintRenderError extends Error {
  constructor(readonly code: PrintRenderErrorCode, message: string) {
    super(message)
    this.name = "PrintRenderError"
  }
}

/** Páginas a las que el proxy o la página mandan a quien no puede ver el documento. */
const DENIED_PATHS = ["/login", "/forbidden", "/modulo-inactivo"]

/**
 * La sesión que se reenvía al navegador sin interfaz. Es opaca a propósito: su
 * `toJSON` y su `toString` no dicen nada, así que un log que la serialice por
 * accidente no filtra la cookie.
 */
export interface PrintCredential {
  readonly cookieHeader: string
  toJSON(): string
  toString(): string
}

const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/

/**
 * Credencial a partir del header `Cookie` de la petición. Guarda solo las
 * cookies de sesión de Auth.js (incluidos sus trozos `.0`, `.1`…): el render no
 * necesita otras, y lo que no se guarda no se puede filtrar.
 */
export function printCredentialFromCookieHeader(header: string | null | undefined): PrintCredential | null {
  if (!header) return null
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const eq = part.indexOf("=")
      return eq > 0 && SESSION_COOKIE.test(part.slice(0, eq))
    })
  if (kept.length === 0) return null
  const cookieHeader = kept.join("; ")
  return {
    cookieHeader,
    toJSON: () => "[redacted]",
    toString: () => "[redacted]",
  }
}

function isDeniedPath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname
    return DENIED_PATHS.some((denied) => pathname === denied || pathname.startsWith(`${denied}/`))
  } catch {
    return false
  }
}

export async function renderPrintPageToPdf(args: {
  origin: string
  spec: PrintDocumentSpec
  entityId: string
  credential: PrintCredential | null
}): Promise<Buffer> {
  const origin = new URL(args.origin).origin
  const target = `${origin}${args.spec.path(args.entityId)}`

  const contextOptions = args.credential ? { extraHTTPHeaders: { cookie: args.credential.cookieHeader } } : {}
  const pdf = await withBrowserContext(contextOptions, async (ctx) => {
    await ctx.route("**/*", async (route: Route) => {
      const request = route.request()
      let sameOrigin = false
      try {
        sameOrigin = new URL(request.url()).origin === origin
      } catch {
        sameOrigin = false
      }
      if (sameOrigin || !args.credential) {
        await route.continue()
        return
      }
      // Otro origen: se pide sin la cookie. `route.fetch` hereda los headers
      // del contexto, así que la cookie se pisa con vacío en vez de omitirse.
      try {
        const response = await route.fetch({ headers: { ...request.headers(), cookie: "" } })
        await route.fulfill({ response })
      } catch {
        await route.abort().catch(() => undefined)
      }
    })

    const page = await ctx.newPage()
    const response = await page.goto(target, { waitUntil: args.spec.waitUntil, timeout: 30_000 })
      .catch((error: unknown) => {
        throw new PrintRenderError("RENDER_FAILED", error instanceof Error ? error.message : "No se pudo abrir la página")
      })
    if (!response) throw new PrintRenderError("RENDER_FAILED", "La página de impresión no respondió")
    const status = response.status()
    if (status === 401 || status === 403 || status === 404 || isDeniedPath(page.url())) {
      throw new PrintRenderError("RENDER_UNAUTHORIZED", "La sesión no puede ver el documento")
    }
    if (status !== 200) throw new PrintRenderError("RENDER_FAILED", `La página de impresión respondió ${status}`)

    try {
      await page.waitForSelector(`[${PRINT_READY_ATTRIBUTE}]`, { state: "attached", timeout: 10_000 })
    } catch {
      // Un redirect tardío (meta refresh de un stream ya empezado) también cae
      // acá: la URL actual dice si fue falta de acceso o un fallo de render.
      throw isDeniedPath(page.url())
        ? new PrintRenderError("RENDER_UNAUTHORIZED", "La sesión no puede ver el documento")
        : new PrintRenderError("RENDER_FAILED", "La página no terminó de mostrar el documento")
    }

    if (args.spec.waitForImages) {
      await page.waitForFunction(
        () => Array.from(document.images).every((image) => image.complete),
        undefined,
        { timeout: 15_000 },
      ).catch(() => {
        // Una imagen que no carga no puede impedir emitir el documento.
      })
    }
    // Márgenes idénticos al @page del CSS del documento; el pie numera las hojas.
    return page.pdf(printPdfOptions(args.spec))
  })

  const buffer = Buffer.from(pdf)
  if (buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new PrintRenderError("INVALID_OUTPUT", "El render no produjo un PDF")
  }
  return buffer
}
