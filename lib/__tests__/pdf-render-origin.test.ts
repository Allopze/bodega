import { afterEach, describe, expect, it } from "vitest"
import { resolvePdfRenderOrigin } from "@/lib/pdf/render-origin"

const envSnapshot = {
  APP_URL: process.env.APP_URL,
  PDF_RENDER_ORIGIN: process.env.PDF_RENDER_ORIGIN,
}

function requestFor(url: string) {
  return new Request(url)
}

afterEach(() => {
  process.env.APP_URL = envSnapshot.APP_URL
  process.env.PDF_RENDER_ORIGIN = envSnapshot.PDF_RENDER_ORIGIN
})

describe("resolvePdfRenderOrigin", () => {
  it("prefers the internal PDF render origin", () => {
    process.env.APP_URL = "https://plataforma.portalchome.cl"
    process.env.PDF_RENDER_ORIGIN = "http://127.0.0.1:3000/"

    expect(resolvePdfRenderOrigin(requestFor("https://0.0.0.0:3000/api/pdf"))).toBe(
      "http://127.0.0.1:3000",
    )
  })

  it("falls back to APP_URL when no internal origin is configured", () => {
    delete process.env.PDF_RENDER_ORIGIN
    process.env.APP_URL = "https://plataforma.portalchome.cl/"

    expect(resolvePdfRenderOrigin(requestFor("https://0.0.0.0:3000/api/pdf"))).toBe(
      "https://plataforma.portalchome.cl",
    )
  })

  it("no cae al origen de la petición: sin configuración lanza", () => {
    delete process.env.APP_URL
    delete process.env.PDF_RENDER_ORIGIN

    // El Host de la petición lo controla el cliente; reenviar la cookie de sesión
    // a ese origen es el riesgo que este cambio cierra.
    expect(() => resolvePdfRenderOrigin(requestFor("https://0.0.0.0:3000/api/pdf"))).toThrow(
      "PDF_ORIGIN_NOT_CONFIGURED",
    )
  })
})
