// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OcDetailItems } from "./oc-detail-items"

describe("OcDetailItems", () => {
  it("makes a pending service cost explicit instead of presenting it as zero", () => {
    render(
      <OcDetailItems
        order={{
          code: "OC-SERVICIO",
          status: "sent",
          netAmount: 0,
          taxAmount: 0,
          totalAmount: 0,
          paymentTerms: null,
          estimatedDelivery: null,
          notes: null,
          worksite: null,
          supplier: null,
          items: [{
            id: "linea-servicio",
            requestItemId: null,
            productId: null,
            productNameFree: "Calibración pendiente",
            quantity: 1,
            unitOfMeasure: "servicio",
            unitPrice: null,
            subtotal: null,
            notes: null,
            equipmentLabel: null,
            workerName: null,
            costRecordedAt: null,
            costRecordedByName: null,
          }],
        }}
        reqItemMap={{}}
        productMap={{}}
      />,
    )

    expect(screen.getAllByText("Costo pendiente")).toHaveLength(4)
  })
})
