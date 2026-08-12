import { describe, expect, it } from "vitest"
import { areEquivalentUnits, matchInvoiceItemsToPurchaseOrderItems } from "./invoice-item-matching"

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

  it.each(["UN", "UND", "Unidad", "unidades"])("treats %s as the same semantic unit", (documentUnit) => {
    expect(areEquivalentUnits(documentUnit, "unidad")).toBe(true)
  })

  it("uses semantic unit aliases to resolve an otherwise ambiguous code", () => {
    const [result] = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Guante Cabritilla Activex", productCode: "05-03-008-T-XL", unitOfMeasure: "Unidad", quantity: 1, unitPrice: 1 },
    ], items)

    expect(result).toMatchObject({ ocItemId: "oc-2", matchType: "code", candidateCount: 2 })
  })

  it("does not link a unique code when the declared units are genuinely incompatible", () => {
    const [result] = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Casco", productCode: "CAS-01", unitOfMeasure: "PAR", quantity: 1, unitPrice: 1 },
    ], items)

    expect(result).toMatchObject({ ocItemId: null, matchType: "unit_mismatch", candidateCount: 1 })
  })

  it("does not silently associate two DTE lines to the same OC line", () => {
    const results = matchInvoiceItemsToPurchaseOrderItems([
      { productName: "Casco", productCode: "CAS-01", unitOfMeasure: "UN", quantity: 1, unitPrice: 1 },
      { productName: "Casco", productCode: "CAS-01", unitOfMeasure: "UN", quantity: 1, unitPrice: 1 },
    ], items)

    expect(results.map((result) => result.ocItemId)).toEqual(["oc-3", null])
  })
})
