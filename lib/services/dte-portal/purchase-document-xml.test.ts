import { describe, expect, it } from "vitest"
import { toDteDocumentItemRows } from "./purchase-document-xml"

describe("toDteDocumentItemRows", () => {
  it("preserves raw fiscal line evidence and produces stable upsert keys", () => {
    const rows = toDteDocumentItemRows("dte-1", [{
      lineNumber: 3,
      productCode: "PROV-01",
      productName: "Casco amarillo",
      description: "Con arnés",
      quantity: 2,
      unitOfMeasure: "UN",
      unitPrice: 1250.55,
      discount: 50,
      amount: 2451.1,
    }])

    expect(rows).toEqual([expect.objectContaining({
      dteDocumentId: "dte-1",
      lineNumber: 3,
      productCode: "PROV-01",
      productName: "Casco amarillo",
      description: "Con arnés",
      unitOfMeasure: "UN",
      quantity: 2,
      unitPrice: 1250.55,
      discount: 50,
      amount: 2451.1,
    })])
    expect(rows[0]?.id).toBe("dte-line:dte-1:3")
  })
})
