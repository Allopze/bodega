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
})
