import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  extractTextFromPdf: vi.fn(),
  extractInvoiceTextOcr: vi.fn(),
}))

vi.mock("./pdf-text-extractor", () => ({ extractTextFromPdf: mocks.extractTextFromPdf }))
vi.mock("./invoice-ocr", () => ({ extractInvoiceTextOcr: mocks.extractInvoiceTextOcr }))

import { extractInvoiceData } from "./invoice-extractor"

describe("extractInvoiceData evidence gates", () => {
  beforeEach(() => {
    mocks.extractTextFromPdf.mockReset()
    mocks.extractInvoiceTextOcr.mockReset()
  })

  it("merges OCR detail with a valid PDF header instead of returning a partial success", async () => {
    mocks.extractTextFromPdf.mockResolvedValue({
      text: "Factura N°: 1200 Fecha de Emisión: 15/01/2026 Total: $11.900 Documento sin detalle seleccionable de productos",
    })
    mocks.extractInvoiceTextOcr.mockResolvedValue({
      text: "Factura N°: 1200 Fecha de Emisión: 15/01/2026 Total: $11.900\nCasco UN 2 5.000 10.000",
      confidence: 0.9,
      pageCount: 1,
    })

    const result = await extractInvoiceData(Buffer.from("%PDF"), "application/pdf", "factura.pdf")

    expect(result).toMatchObject({
      method: "pdf_text_ocr",
      data: expect.objectContaining({ invoiceNumber: "1200", totalAmount: 11900 }),
    })
    expect(result.data?.items).toHaveLength(1)
    expect(result.warnings).toContain("El texto del PDF permitió identificar la cabecera, pero no sus líneas; se intentó OCR adicional.")
  })

  it("does not report low-semantic OCR text as a successful extraction", async () => {
    mocks.extractInvoiceTextOcr.mockResolvedValue({
      text: "ruido de OCR sin folio ni total verificable",
      confidence: 0.91,
      pageCount: 1,
    })

    const result = await extractInvoiceData(Buffer.from("image"), "image/png", "factura.png")

    expect(result).toMatchObject({ data: null, method: "manual", quality: { coverage: 0 } })
    expect(result.warnings).toContain("El OCR no identificó folio, fecha y total verificables; completa los datos manualmente.")
  })
})

describe("señales de calidad", () => {
  beforeEach(() => {
    mocks.extractTextFromPdf.mockReset()
    mocks.extractInvoiceTextOcr.mockReset()
  })

  it("separa cobertura de campos, confianza del motor y cuadratura de montos", async () => {
    // Documento completo en campos pero con aritmética imposible: la cobertura
    // es total y aun así no está verificado. Con un solo número —el viejo
    // "confianza"— esto se anunciaba como 100%.
    mocks.extractInvoiceTextOcr.mockResolvedValue({
      text: "Factura N° 55 Fecha de Emisión: 14/07/2026\nNeto: 10.000\nIVA 19%: 1.900\nTotal: 99.999",
      confidence: 0.72,
      pageCount: 1,
    })

    const result = await extractInvoiceData(Buffer.from("image"), "image/png", "factura.png")

    expect(result.quality).toEqual({
      coverage: expect.any(Number),
      engineConfidence: 0.72,
      totalsConsistent: false,
    })
    expect(result.warnings).toContain("Neto, IVA y total extraídos no cuadran entre sí; confirma los montos.")
  })

  it("no inventa confianza de motor en un PDF con texto", async () => {
    mocks.extractTextFromPdf.mockResolvedValue({
      // El extractor exige texto con sustancia antes de confiar en la capa
      // textual del PDF, así que la muestra trae emisor y giro como una real.
      text: [
        "PROVEEDOR DEMO SPA GIRO: Venta de material industrial",
        "Factura N°: 1200 Fecha de Emisión: 15/01/2026",
        "Casco UN 2 5.000 10.000",
        "Neto: 10.000",
        "IVA 19%: 1.900",
        "Total: 11.900",
      ].join("\n"),
    })

    const result = await extractInvoiceData(Buffer.from("%PDF"), "application/pdf", "factura.pdf")

    expect(result.method).toBe("pdf_text")
    expect(result.quality.engineConfidence).toBeNull()
    expect(result.quality.totalsConsistent).toBe(true)
    expect(result.quality.coverage).toBe(1)
  })
})
