import { describe, expect, it } from "vitest"
import { A4_MARGIN, a4PdfOptions, parseMmMargin } from "@/lib/pdf/page-options"

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

describe("parseMmMargin", () => {
  it("convierte la caja A4 de mm a px CSS a 96 dpi", () => {
    const px = parseMmMargin(A4_MARGIN)
    expect(px.top).toBeCloseTo(45.354, 3)
    expect(px.right).toBeCloseTo(45.354, 3)
    expect(px.bottom).toBeCloseTo(75.591, 3)
    expect(px.left).toBeCloseTo(45.354, 3)
  })

  it("usa A4_MARGIN por defecto", () => {
    expect(parseMmMargin()).toEqual(parseMmMargin(A4_MARGIN))
  })

  it("acepta decimales y espacios", () => {
    expect(parseMmMargin({ top: "12.5mm", right: " 0mm ", bottom: "20mm", left: "1mm" }).top)
      .toBeCloseTo(12.5 * 96 / 25.4, 6)
  })

  it("rechaza un margen que no esté en mm, en vez de calcular una caja silenciosamente mal", () => {
    expect(() => parseMmMargin({ top: "12px", right: "0mm", bottom: "0mm", left: "0mm" }))
      .toThrow(/Margen no expresado en mm/)
  })
})
