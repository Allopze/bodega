import { describe, it, expect } from "vitest"
import { parseInvoiceText } from "./invoice-text-parser"

describe("parseInvoiceText", () => {
  it("extracts invoice number from Chilean format", () => {
    const text = "Factura N°: 00012345 Fecha: 15/01/2026 Total: $119.000"
    const result = parseInvoiceText(text)
    expect(result.invoiceNumber).toBe("00012345")
  })

  it("extracts invoice number from 'Folio' format", () => {
    const text = "Folio: 5678 Fecha de Emisión: 2026-01-15"
    const result = parseInvoiceText(text)
    expect(result.invoiceNumber).toBe("5678")
  })

  it("extracts date in DD/MM/YYYY format", () => {
    const text = "Fecha de Emisión: 15/01/2026"
    const result = parseInvoiceText(text)
    expect(result.issueDate).toBe("2026-01-15")
  })

  it("extracts date in YYYY-MM-DD format", () => {
    const text = "Fecha: 2026-06-15"
    const result = parseInvoiceText(text)
    expect(result.issueDate).toBe("2026-06-15")
  })

  it("extracts total amount with Chilean number format", () => {
    const text = "Total a pagar: $1.234.567"
    const result = parseInvoiceText(text)
    expect(result.totalAmount).toBe(1234567)
  })

  it("extracts total amount with 'Monto Total'", () => {
    const text = "Monto Total: $500.000"
    const result = parseInvoiceText(text)
    expect(result.totalAmount).toBe(500000)
  })

  it("extracts net amount", () => {
    const text = "Neto: $100.000 IVA: $19.000 Total: $119.000"
    const result = parseInvoiceText(text)
    expect(result.netAmount).toBe(100000)
    expect(result.taxAmount).toBe(19000)
  })

  it("extracts supplier RUT", () => {
    const text = "Emisor: RUT 76.123.456-7 Empresa SpA"
    const result = parseInvoiceText(text)
    expect(result.supplierRut).toBe("76.123.456-7")
  })

  it("handles text with multiple spaces", () => {
    const text = "Factura   N°:   12345   Total:   $50.000"
    const result = parseInvoiceText(text)
    expect(result.invoiceNumber).toBe("12345")
    expect(result.totalAmount).toBe(50000)
  })

  it("returns null fields for unrecognizable text", () => {
    const text = "Lorem ipsum dolor sit amet"
    const result = parseInvoiceText(text)
    expect(result.invoiceNumber).toBeNull()
    expect(result.issueDate).toBeNull()
    expect(result.totalAmount).toBeNull()
  })

  it("extracts a Crystal Reports invoice with reordered visual columns", () => {
    const text = [
      "Nº 3064428 R.U.T.: 96.542.490-3 FACTURA ELECTRONICA",
      "Fecha de Emisión : : Vendedor 14/07/2026",
      "TRECK S.A GIRO: FABRICA DE CALZADO",
      "Precio Unitario Valor Total Descripción Código Cantidad",
      "1.150 57.500 50 Guante Cabritilla Activex con Forro gris T- XL 05-03-008-T-XL",
      "Total Neto Descuento I.V.A. (19%) Total 57.500 10.925 68.425",
    ].join("\n")

    expect(parseInvoiceText(text)).toMatchObject({
      invoiceNumber: "3064428",
      issueDate: "2026-07-14",
      supplierName: "TRECK S.A",
      supplierRut: "96.542.490-3",
      netAmount: 57500,
      taxAmount: 10925,
      totalAmount: 68425,
      items: [{
        productName: "Guante Cabritilla Activex con Forro gris T- XL",
        productCode: "05-03-008-T-XL",
        unitOfMeasure: null,
        quantity: 50,
        unitPrice: 1150,
        amount: 57500,
      }],
    })
  })

  it("keeps a declared document unit without inventing one", () => {
    const result = parseInvoiceText("Casco UN 2 5.000 10.000")
    expect(result.items[0]).toMatchObject({ unitOfMeasure: "UN", quantity: 2 })
  })

  // Regresiones encontradas ejercitando OCR real (ver invoice-ocr.test.ts), no
  // texto de PDF: el motor degrada el ordinal y la tabla trae encabezados.
  it("reconoce el folio aunque el OCR degrade el ordinal de N°", () => {
    for (const ordinal of ["N°", "N*", "No", "N?", "N."]) {
      const result = parseInvoiceText(`FACTURA ELECTRONICA ${ordinal} 3064428\nFecha de Emision: 14/07/2026\nTotal: 68.425`)
      expect(result.invoiceNumber, ordinal).toBe("3064428")
    }
  })

  it("no toma el encabezado de columna TOTAL como el total del documento", () => {
    // El rótulo de la columna y el código de la primera línea daban $5.
    const result = parseInvoiceText([
      "CODIGO DESCRIPCION CANTIDAD PRECIO TOTAL",
      "05-03-008 GUANTE CABRITILLA 50 1.150 57.500",
      "Neto: 57.500",
      "IVA 19%: 10.925",
      "Total: 68.425",
    ].join("\n"))

    expect(result.totalAmount).toBe(68425)
    expect(result.netAmount).toBe(57500)
    expect(result.taxAmount).toBe(10925)
  })
})
