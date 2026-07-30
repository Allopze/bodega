import { describe, expect, it } from "vitest"
import { matchInvoiceItemsToPurchaseOrderItems } from "./invoice-item-matching"

const items = [
  { id: "oc-1", productName: "Guante Cabritilla Activex", productCode: "05-03-008-T-XL", unitOfMeasure: "PAR" },
  { id: "oc-2", productName: "Guante Cabritilla Activex", productCode: "05-03-008-T-XL", unitOfMeasure: "UN" },
  { id: "oc-3", productName: "Casco Amarillo", productCode: "CAS-01", unitOfMeasure: "UN" },
]

describe("matchInvoiceItemsToPurchaseOrderItems", () => {
  it("links a unique normalized product code", () => {
    const [result] = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Casco", productCode: "cas 01", unitOfMeasure: "UN", quantity: 1, unitPrice: 1 },
    ], items)
    expect(result).toMatchObject({ ocItemId: "oc-3", matchType: "code", candidateCount: 1 })
  })

  it("does not link a duplicated code without a disambiguating unit", () => {
    const [result] = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Guante Cabritilla Activex", productCode: "05-03-008-T-XL", unitOfMeasure: null, quantity: 1, unitPrice: 1 },
    ], items)
    expect(result).toMatchObject({ ocItemId: null, matchType: "ambiguous", candidateCount: 2 })
  })

  it("uses a declared document unit only to resolve an otherwise ambiguous match", () => {
    const [result] = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Guante Cabritilla Activex", productCode: "05-03-008-T-XL", unitOfMeasure: "PAR", quantity: 1, unitPrice: 1 },
    ], items)
    expect(result).toMatchObject({ ocItemId: "oc-1", matchType: "code", candidateCount: 2 })
  })
})
