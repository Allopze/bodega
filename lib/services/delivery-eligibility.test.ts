import { describe, expect, it } from "vitest"

import { getTraceableDeliveryBalance } from "./delivery-eligibility"

describe("getTraceableDeliveryBalance", () => {
  it("no habilita una entrega trazable sólo porque exista stock", () => {
    expect(getTraceableDeliveryBalance({
      requestedQuantity: 4,
      receivedAtFaena: 0,
      deliveredQuantity: 0,
    })).toBe(0)
  })

  it("respeta las recepciones parciales y las entregas ya registradas", () => {
    expect(getTraceableDeliveryBalance({
      requestedQuantity: 8,
      receivedAtFaena: 5,
      deliveredQuantity: 2,
    })).toBe(3)
  })

  it("no abre saldo por encima de la cantidad solicitada", () => {
    expect(getTraceableDeliveryBalance({
      requestedQuantity: 4,
      receivedAtFaena: 7,
      deliveredQuantity: 1,
    })).toBe(3)
  })
})
