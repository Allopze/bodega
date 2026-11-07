// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OcDetailItems } from "./oc-detail-items"
import type { OcDetailItem } from "./oc-detail.types"

function orderWith(item: Partial<OcDetailItem>) {
  return {
    code: "OC-REPUESTO",
    status: "sent",
    netAmount: 20_000,
    taxAmount: 3_800,
    totalAmount: 23_800,
    paymentTerms: null,
    estimatedDelivery: null,
    notes: null,
    worksite: null,
    supplier: null,
    items: [{
      id: "linea-repuesto",
      requestItemId: null,
      productId: null,
      productNameFree: "Manguera hidráulica",
      quantity: 1,
      unitOfMeasure: "unidad",
      unitPrice: 20_000,
      subtotal: 20_000,
      notes: null,
      equipmentLabel: null,
      workerName: null,
      costRecordedAt: null,
      costRecordedByName: null,
      ...item,
    }],
  }
}

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

  it("ItemContext muestra equipo y OT", () => {
    render(
      <OcDetailItems
        order={orderWith({ vehicleLabel: "KA-63 · ABCD-12", workOrderFolio: "M-0042" })}
        reqItemMap={{}}
        productMap={{}}
      />,
    )

    // La OC de un repuesto dice sobre qué equipo y para qué OT es. Las filas
    // salen dos veces (tarjetas móviles y tabla): ambas deben decirlo.
    expect(screen.getAllByText("Equipo: KA-63 · ABCD-12 · OT M-0042")).toHaveLength(2)
  })

  it("con vehículo pero sin OT dice sólo el equipo", () => {
    render(
      <OcDetailItems
        order={orderWith({ vehicleLabel: "ABCD-12" })}
        reqItemMap={{}}
        productMap={{}}
      />,
    )

    expect(screen.getAllByText("Equipo: ABCD-12")).toHaveLength(2)
    expect(screen.queryByText(/OT /)).toBeNull()
  })

  it("sin vehículo no inventa una línea de equipo", () => {
    render(
      <OcDetailItems order={orderWith({})} reqItemMap={{}} productMap={{}} />,
    )

    expect(screen.queryByText(/Equipo:/)).toBeNull()
  })

  it("un servicio con instrumento conserva su rótulo de equipo", () => {
    render(
      <OcDetailItems
        order={orderWith({ equipmentLabel: "EQ-1 · Balanza", workerName: "Ana Pérez" })}
        reqItemMap={{}}
        productMap={{}}
      />,
    )

    expect(screen.getAllByText("Equipo: EQ-1 · Balanza · Colaborador: Ana Pérez")).toHaveLength(2)
  })
})
