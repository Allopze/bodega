import { describe, expect, it } from "vitest"
import { A4_MARGIN, a4PdfOptions } from "@/lib/pdf/page-options"

describe("a4PdfOptions", () => {
  it("emite un pie con la numeración que Chromium sustituye", () => {
    const { displayHeaderFooter, footerTemplate } = a4PdfOptions()

    expect(displayHeaderFooter).toBe(true)
    expect(footerTemplate).toContain('class="pageNumber"')
    expect(footerTemplate).toContain('class="totalPages"')
  })

  it("fija un font-size explícito en el pie", () => {
    // Regresión: el template del pie se renderiza con font-size 0 por defecto,
    // así que sin un tamaño inline el número de página sale invisible.
    expect(a4PdfOptions().footerTemplate).toMatch(/font-size:\s*\d/)
  })

  it("suprime la cabecera por defecto de Chromium con un template vacío", () => {
    // Con displayHeaderFooter y sin headerTemplate, Chromium imprime título+URL.
    expect(a4PdfOptions().headerTemplate.trim()).not.toBe("")
    expect(a4PdfOptions().headerTemplate).not.toMatch(/pageNumber|title|date/)
  })

  it("reserva margen inferior para la banda del pie", () => {
    expect(a4PdfOptions().margin).toEqual(A4_MARGIN)
    expect(Number.parseFloat(A4_MARGIN.bottom)).toBeGreaterThanOrEqual(16)
  })

  it("propaga el margen propio de cada documento", () => {
    const margin = { top: "12mm", right: "14mm", bottom: "20mm", left: "14mm" }

    expect(a4PdfOptions(margin).margin).toEqual(margin)
  })
})
