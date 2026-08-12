import { describe, expect, it } from "vitest"
import { describeStageProgress } from "./receipt-form-progress"
import type { ReceiptOcItem } from "./receipt-form.types"

function item(overrides: Partial<ReceiptOcItem> = {}): ReceiptOcItem {
  return {
    id: "oci-1",
    requestItemId: "ri-1",
    productName: "Casco",
    productSku: "EPP-001",
    quantity: 10,
    quantityOfficeReceived: 0,
    quantityReceived: 0,
    unitOfMeasure: "unidad",
    notes: null,
    ...overrides,
  }
}

describe("describeStageProgress", () => {
  it("parte con las dos etapas pendientes", () => {
    const p = describeStageProgress([item()], "via_oficina")
    expect(p).toMatchObject({ office: "Pendiente", faena: "Pendiente", officeComplete: false, faenaComplete: false })
  })

  it("muestra la fracción en oficina y lo que queda por despachar", () => {
    const p = describeStageProgress([item({ quantityOfficeReceived: 4 })], "via_oficina")
    expect(p.office).toBe("4 / 10 unidad")
    expect(p.faena).toBe("4 unidad por despachar")
    expect(p.officeComplete).toBe(false)
  })

  it("da la oficina por completa cuando llegó todo", () => {
    const p = describeStageProgress([item({ quantityOfficeReceived: 10 })], "via_oficina")
    expect(p.office).toBe("10 unidad · completo")
    expect(p.officeComplete).toBe(true)
    expect(p.faenaComplete).toBe(false)
  })

  it("no canta faena completa mientras la oficina siga corta, aunque nada quede por despachar", () => {
    // A-08: con 6 de 12 recibidas y esas 6 ya despachadas, "por despachar" es 0
    // pero la etapa no está cerrada — la tarjeta de faena sigue deshabilitada.
    const p = describeStageProgress([item({ quantity: 12, quantityOfficeReceived: 6, quantityReceived: 6 })], "via_oficina")
    expect(p.faenaComplete).toBe(false)
  })

  it("cuenta líneas, no unidades, cuando la OC mezcla unidades de medida", () => {
    // A-09: "12 par + 5 rollo = 17 un." es un número sin significado.
    const p = describeStageProgress([
      item({ id: "a", unitOfMeasure: "par", quantity: 12, quantityOfficeReceived: 12 }),
      item({ id: "b", unitOfMeasure: "rollo", quantity: 5, quantityOfficeReceived: 0 }),
    ], "via_oficina")
    expect(p.office).toBe("1 / 2 líneas")
  })

  it("en despacho directo mide la faena contra lo pedido, sin pasar por oficina", () => {
    const parcial = describeStageProgress([item({ quantityReceived: 3 })], "directo_faena")
    expect(parcial.faena).toBe("3 / 10 unidad")
    expect(parcial.faenaComplete).toBe(false)

    const total = describeStageProgress([item({ quantityReceived: 10 })], "directo_faena")
    expect(total.faenaComplete).toBe(true)
  })

  it("no da por completa una OC sin líneas", () => {
    const p = describeStageProgress([], "via_oficina")
    expect(p.officeComplete).toBe(false)
    expect(p.faenaComplete).toBe(false)
  })
})
