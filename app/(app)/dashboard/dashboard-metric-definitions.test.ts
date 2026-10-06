import { describe, expect, it } from "vitest"
import { billingPeriodLabel } from "./dashboard-charts"
import { ORDERS_ISSUED_METRIC, ORDERS_SPEND_METRIC } from "./dashboard-metric-definitions"

// INI-01: un nombre por definición; el monto no puede llamarse distinto según la vista.
describe("definiciones compartidas del tablero", () => {
  it("fija un nombre y una explicación para cada cifra repetida entre vistas", () => {
    expect(ORDERS_ISSUED_METRIC.label).toBe("OC emitidas")
    expect(ORDERS_SPEND_METRIC.label).toBe("Gasto en OC")
    expect(ORDERS_ISSUED_METRIC.glossary).toMatch(/borrador/)
    expect(ORDERS_ISSUED_METRIC.glossary).toMatch(/anuladas/)
  })
})

describe("billingPeriodLabel", () => {
  it("rotula el mes en español en vez de mostrar la clave cruda", () => {
    expect(billingPeriodLabel("2026-07")).toBe("Jul 2026")
    expect(billingPeriodLabel("2026-12")).toBe("Dic 2026")
  })

  it("deja intacta una clave que no es año-mes", () => {
    expect(billingPeriodLabel("2026")).toBe("2026")
    expect(billingPeriodLabel("2026-13")).toBe("2026-13")
  })
})
