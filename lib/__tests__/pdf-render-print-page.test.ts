import { beforeEach, describe, expect, it, vi } from "vitest"

type FakeRoute = {
  request: () => { url: () => string; headers: () => Record<string, string> }
  continue: () => Promise<void>
  fetch: (options: { headers: Record<string, string> }) => Promise<unknown>
  fulfill: (options: { response: unknown }) => Promise<void>
  abort: () => Promise<void>
}
type RouteHandler = (route: FakeRoute) => Promise<void>

const browser = vi.hoisted(() => ({
  status: 200,
  finalUrl: "http://127.0.0.1:3000/entregas/d1/print",
  markerPresent: true,
  pdfBytes: Buffer.from("%PDF-1.7 prueba"),
  handler: null as RouteHandler | null,
  contextOptions: null as null | { extraHTTPHeaders?: Record<string, string> },
}))

vi.mock("@/lib/pdf/browser-pool", () => ({
  withBrowserContext: async (options: { extraHTTPHeaders?: Record<string, string> }, fn: (ctx: unknown) => Promise<unknown>) => {
    browser.contextOptions = options
    return fn({
    route: async (_pattern: string, handler: RouteHandler) => { browser.handler = handler },
    newPage: async () => ({
      goto: async () => ({ status: () => browser.status }),
      url: () => browser.finalUrl,
      waitForSelector: async () => {
        if (!browser.markerPresent) throw new Error("timeout")
      },
      waitForFunction: async () => undefined,
      pdf: async () => browser.pdfBytes,
    }),
    })
  },
}))

const { PrintRenderError, printCredentialFromCookieHeader, renderPrintPageToPdf } = await import("@/lib/pdf/render-print-page")
const { PRINT_DOCUMENT_SPECS } = await import("@/lib/pdf/print-specs")

const ORIGIN = "http://127.0.0.1:3000"
const credential = printCredentialFromCookieHeader("theme=dark; authjs.session-token=abc; __Secure-authjs.session-token.0=p1; __Secure-authjs.session-token.1=p2; authjs.csrf-token=zz")

function render() {
  return renderPrintPageToPdf({ origin: ORIGIN, spec: PRINT_DOCUMENT_SPECS.entrega, entityId: "d1", credential })
}

beforeEach(() => {
  browser.status = 200
  browser.finalUrl = `${ORIGIN}/entregas/d1/print`
  browser.markerPresent = true
  browser.pdfBytes = Buffer.from("%PDF-1.7 prueba")
  browser.handler = null
})

describe("printCredentialFromCookieHeader", () => {
  it("guarda solo las cookies de sesión de Auth.js, trozos incluidos", () => {
    expect(credential?.cookieHeader).toBe(
      "authjs.session-token=abc; __Secure-authjs.session-token.0=p1; __Secure-authjs.session-token.1=p2",
    )
  })

  it("no se deja serializar", () => {
    expect(JSON.stringify({ credential })).toBe('{"credential":"[redacted]"}')
    expect(String(credential)).toBe("[redacted]")
  })

  it("sin sesión no hay credencial", () => {
    expect(printCredentialFromCookieHeader("theme=dark")).toBeNull()
    expect(printCredentialFromCookieHeader(null)).toBeNull()
  })
})

describe("renderPrintPageToPdf", () => {
  it("devuelve el PDF y solo manda la cookie a la propia plataforma", async () => {
    const pdf = await render()
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
    expect(browser.contextOptions?.extraHTTPHeaders).toEqual({ cookie: credential!.cookieHeader })

    const calls: Array<{ url: string; via: string; cookie?: string }> = []
    for (const url of [`${ORIGIN}/entregas/d1/print`, "https://cdn.externo.test/pictograma.png"]) {
      await browser.handler!({
        request: () => ({ url: () => url, headers: () => ({ accept: "*/*", cookie: credential!.cookieHeader }) }),
        continue: async () => { calls.push({ url, via: "continue" }) },
        fetch: async ({ headers }) => { calls.push({ url, via: "fetch", cookie: headers.cookie }); return {} },
        fulfill: async () => undefined,
        abort: async () => undefined,
      })
    }
    // La plataforma sigue con la cookie del contexto; el host ajeno se pide con la cookie vacía.
    expect(calls).toEqual([
      { url: `${ORIGIN}/entregas/d1/print`, via: "continue" },
      { url: "https://cdn.externo.test/pictograma.png", via: "fetch", cookie: "" },
    ])
  })

  it("una redirección al login o a módulo inactivo es falta de acceso, no un documento", async () => {
    for (const denied of ["/login", "/forbidden", "/modulo-inactivo"]) {
      browser.finalUrl = `${ORIGIN}${denied}`
      await expect(render()).rejects.toMatchObject({ code: "RENDER_UNAUTHORIZED" })
    }
  })

  it("un 404 es falta de acceso y un 500 es un fallo de render", async () => {
    browser.status = 404
    await expect(render()).rejects.toMatchObject({ code: "RENDER_UNAUTHORIZED" })
    browser.status = 500
    await expect(render()).rejects.toMatchObject({ code: "RENDER_FAILED" })
  })

  it("sin la marca data-print-ready la página no mostró el documento", async () => {
    browser.markerPresent = false
    await expect(render()).rejects.toBeInstanceOf(PrintRenderError)
    await expect(render()).rejects.toMatchObject({ code: "RENDER_FAILED" })
  })

  it("rechaza una salida que no es un PDF", async () => {
    browser.pdfBytes = Buffer.from("<html>")
    await expect(render()).rejects.toMatchObject({ code: "INVALID_OUTPUT" })
  })
})
