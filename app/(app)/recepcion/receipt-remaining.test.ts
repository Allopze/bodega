/**
 * `REC-002` (auditoría 2026-09-14): el formulario restaba sólo lo recibido; el
 * servidor descuenta la disposición completa de la etapa —recibido, rechazado y
 * dañado— contra la capacidad de la línea. Con 6 recibidas y 4 rechazadas en
 * oficina sobre una OC de 10, la pantalla ofrecía 4, precargaba 4, no marcaba
 * nada, y el envío fallaba con «quedan 0 y estás registrando 4».
 */
import { describe, expect, it } from "vitest"
import type { ReceiptOcItem } from "./receipt-form.types"
import { alreadyDisposed, dispositionCapacity, remainingForStage, stageHasPending } from "./receipt-remaining"

function item(overrides: Partial<ReceiptOcItem> = {}): ReceiptOcItem {
  return {
    id: "oci-1", requestItemId: "ri-1", productName: "Casco", productSku: "EPP-001",
    quantity: 10, quantityOfficeReceived: 0, quantityReceived: 0,
    quantityOfficeDisposed: 0, quantityFaenaDisposed: 0,
    unitOfMeasure: "unidad", notes: null, ...overrides,
  }
}

/** El caso exacto de la ficha: 6 recibidas y 4 rechazadas en oficina. */
const RECHAZO_PARCIAL = item({ quantityOfficeReceived: 6, quantityOfficeDisposed: 10 })

describe("el saldo de la etapa de oficina", () => {
  it("no ofrece lo rechazado como si estuviera pendiente", () => {
    expect(remainingForStage(RECHAZO_PARCIAL, "office", "via_oficina")).toBe(0)
    expect(stageHasPending([RECHAZO_PARCIAL], "office", "via_oficina")).toBe(false)
  })

  it("sigue ofreciendo lo que de verdad falta", () => {
    const parcial = item({ quantityOfficeReceived: 6, quantityOfficeDisposed: 6 })
    expect(remainingForStage(parcial, "office", "via_oficina")).toBe(4)
  })

  it("el techo de la etapa es lo pedido", () => {
    expect(dispositionCapacity(item(), "office", "via_oficina")).toBe(10)
  })
})

describe("el saldo de la etapa de faena", () => {
  it("vía oficina, sólo puede recibir lo que llegó a oficina", () => {
    const enTransito = item({ quantityOfficeReceived: 6, quantityOfficeDisposed: 10 })
    expect(remainingForStage(enTransito, "faena", "via_oficina")).toBe(6)
  })

  it("descuenta también lo que se rechazó en faena", () => {
    const conRechazoEnFaena = item({
      quantityOfficeReceived: 6, quantityOfficeDisposed: 10,
      quantityReceived: 4, quantityFaenaDisposed: 6,
    })
    expect(remainingForStage(conRechazoEnFaena, "faena", "via_oficina")).toBe(0)
  })

  it("en despacho directo el techo es lo pedido, sin pasar por oficina", () => {
    const directo = item({ quantityReceived: 3, quantityFaenaDisposed: 4 })
    expect(remainingForStage(directo, "faena", "directo_faena")).toBe(6)
  })

  it("nunca devuelve un saldo negativo", () => {
    const excedido = item({ quantityOfficeReceived: 2, quantityOfficeDisposed: 99 })
    expect(remainingForStage(excedido, "office", "via_oficina")).toBe(0)
  })
})

describe("la disposición nunca es menor que lo recibido", () => {
  it("una pantalla que no la pase degrada a la fórmula antigua, no al revés", () => {
    // Conservador de más antes que ofrecer otra vez lo ya recibido.
    const sinDisposicion = item({ quantityOfficeReceived: 6 })
    expect(alreadyDisposed(sinDisposicion, "office")).toBe(6)
    expect(remainingForStage(sinDisposicion, "office", "via_oficina")).toBe(4)
  })
})
