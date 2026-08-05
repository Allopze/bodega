import { describe, it, expect } from "vitest"
import { classifyPair } from "../duplicates"

function invoice(overrides: Partial<Parameters<typeof classifyPair>[0]> = {}) {
  return {
    id: "inv-a",
    direction: "sale",
    docType: "33",
    folio: 1234,
    issuerTaxId: "78023530-6",
    receiverTaxId: "76543210-K",
    issueDate: "2026-07-15",
    currency: "CLP",
    totalAmount: 1000000,
    documentStatus: "accepted",
    ...overrides,
  }
}

describe("classifyPair — cuándo marca un par para revisión", () => {
  it("marca como probable el mismo monto en la misma fecha con distinto folio", () => {
    const pair = classifyPair(invoice(), invoice({ id: "inv-b", folio: 1299 }))
    expect(pair?.classification).toBe("probable")
    expect(pair?.evidence.notes.join(" ")).toMatch(/Mismo monto/)
  })

  it("marca como posible el mismo monto con fechas separadas", () => {
    const pair = classifyPair(
      invoice(),
      invoice({ id: "inv-b", folio: 1299, docType: "34", issueDate: "2026-08-10" }),
    )
    expect(pair?.classification).toBe("possible")
  })

  it("marca como conflicto el mismo documento con montos distintos", () => {
    const pair = classifyPair(invoice(), invoice({ id: "inv-b", totalAmount: 1500000 }))
    expect(pair?.classification).toBe("conflict")
    expect(pair?.evidence.notes.join(" ")).toMatch(/montos distintos/i)
  })

  it("NO marca facturas de contrapartes distintas", () => {
    expect(classifyPair(invoice(), invoice({ id: "inv-b", receiverTaxId: "77999999-9" }))).toBeNull()
  })

  it("NO marca facturas en monedas distintas", () => {
    expect(classifyPair(invoice(), invoice({ id: "inv-b", currency: "USD", folio: 1299 }))).toBeNull()
  })

  it("NO cruza una venta con una compra", () => {
    expect(classifyPair(invoice(), invoice({ id: "inv-b", direction: "purchase", folio: 1299 }))).toBeNull()
  })

  it("NO marca montos claramente distintos", () => {
    expect(classifyPair(invoice(), invoice({ id: "inv-b", folio: 1299, totalAmount: 2000000 }))).toBeNull()
  })

  it("NO marca facturas separadas por más de la ventana", () => {
    expect(classifyPair(invoice(), invoice({ id: "inv-b", folio: 1299, issueDate: "2027-01-15" }))).toBeNull()
  })

  it("tolera una diferencia de redondeo bancario", () => {
    const pair = classifyPair(invoice(), invoice({ id: "inv-b", folio: 1299, totalAmount: 1000500 }))
    expect(pair?.classification).toBe("probable")
  })

  it("registra cuántos días separan las emisiones", () => {
    const pair = classifyPair(
      invoice(),
      invoice({ id: "inv-b", folio: 1299, issueDate: "2026-07-25" }),
    )
    expect(pair?.evidence.daysApart).toBe(10)
    expect(pair?.evidence.notes.join(" ")).toMatch(/10 días de diferencia/)
  })
})
