import { describe, expect, it } from "vitest"
import { fuelPendingText, openOrdersText } from "./summary-text"

describe("Resumen de la ficha: textos", () => {
  it("las OT abiertas: ninguna, una, varias; sin permiso de OT no se mencionan", () => {
    expect(openOrdersText(null)).toBeNull()
    expect(openOrdersText({ count: 0, latest: null })).toBe("sin órdenes de trabajo abiertas")
    const latest = { id: "ot-1", folio: "OT-0412", status: "en_ejecucion" as const, daysInWorkshop: 2 }
    expect(openOrdersText({ count: 1, latest })).toMatch(/^orden abierta: OT-0412 /)
    expect(openOrdersText({ count: 1_204, latest })).toMatch(/^1\.204 órdenes abiertas; la más reciente, OT-0412 /)
  })

  it("lo pendiente de combustible con la definición del Panel operacional: cargas y pedidos por decidir, casos aparte", () => {
    expect(fuelPendingText({ carga: 0, caso: 0, pedido: 0 })).toBe("nada pendiente")
    expect(fuelPendingText({ carga: 2, caso: 0, pedido: 1 })).toBe("3 por decidir")
    expect(fuelPendingText({ carga: 0, caso: 1, pedido: 0 })).toBe("1 caso en seguimiento")
    expect(fuelPendingText({ carga: 1, caso: 14, pedido: 0 })).toBe("1 por decidir · 14 casos en seguimiento")
  })
})
