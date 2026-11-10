import { describe, expect, it } from "vitest"
import { vehicleLabel } from "@/lib/fleet-vehicle-label"
import { requestItemAssetLabel } from "@/lib/purchasing/request-item-asset"

describe("vehicleLabel", () => {
  it("código y patente, o sólo la patente cuando el equipo no tiene código", () => {
    expect(vehicleLabel({ code: "KA-122", plate: "ABCD-12" })).toBe("KA-122 · ABCD-12")
    expect(vehicleLabel({ code: null, plate: "ABCD-12" })).toBe("ABCD-12")
  })
})

/**
 * El «Equipo» de una línea de OC: la ficha de la OC y el documento que se imprime lo
 * dicen igual (FF-7, segundo recorrido 2026-11-09).
 */
describe("requestItemAssetLabel", () => {
  it("el equipo de flota lleva la OT de mantención que originó el pedido", () => {
    expect(requestItemAssetLabel({ vehicleLabel: "KA-63 · ABCD-12", workOrderFolio: "M-0042" })).toBe("KA-63 · ABCD-12 · OT M-0042")
    expect(requestItemAssetLabel({ vehicleLabel: "ABCD-12", workOrderFolio: null })).toBe("ABCD-12")
    expect(requestItemAssetLabel({ vehicleLabel: "ABCD-12" })).toBe("ABCD-12")
  })

  it("el instrumento de un servicio manda y no arrastra OT", () => {
    expect(requestItemAssetLabel({ equipmentLabel: "EQ-01 · Retroexcavadora", vehicleLabel: "ABCD-12", workOrderFolio: "M-0042" }))
      .toBe("EQ-01 · Retroexcavadora")
  })

  it("sin equipo ni vehículo no hay etiqueta, aunque exista una OT", () => {
    expect(requestItemAssetLabel({})).toBeNull()
    expect(requestItemAssetLabel({ workOrderFolio: "M-0042" })).toBeNull()
    expect(requestItemAssetLabel({ equipmentLabel: "", vehicleLabel: null })).toBeNull()
  })
})
