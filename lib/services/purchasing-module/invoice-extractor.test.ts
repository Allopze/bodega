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

    expect(result).toMatchObject({ data: null, method: "manual", confidence: 0 })
    expect(result.warnings).toContain("El OCR no identificó folio, fecha y total verificables; completa los datos manualmente.")
  })
})
