/**
 * `GDI-001` (auditoría 2026-09-14): el traslado interno mueve stock al
 * despachar, y el cotejo en faena acepta recibir menos —con motivo obligatorio—
 * sin tocar el saldo del destino. Los bienes que nunca llegaron seguían
 * contados en la faena y **ningún detector miraba las guías**: la
 * regularización quedaba encomendada a un ajuste manual que nada exigía ni
 * recordaba.
 */
import { describe, expect, it } from "vitest"
import { detectDispatchGuideShrinkage, type GuideShortfallLine } from "./dispatch-guide-detector"

function line(overrides: Partial<GuideShortfallLine> = {}): GuideShortfallLine {
  return {
    guideId: "gdi-1", guideCode: "GDI-0001", destinationWorksiteId: "ws-1",
    guideStatus: "partially_received", itemId: "gi-1",
    productId: "p-1", productName: "Casco",
    quantity: 5, quantityReceived: 3, differenceReason: "Faltaron dos unidades",
    receivedAt: "2026-09-10T12:00:00.000Z", ...overrides,
  }
}

describe("la merma de un traslado que nadie regulariza", () => {
  it("la nombra con su cantidad, su motivo y el enlace a la guía", () => {
    const [finding] = detectDispatchGuideShrinkage({ lines: [line()] })
    expect(finding).toBeDefined()
    expect(finding!.code).toBe("DISPATCH_GUIDE_SHRINKAGE_UNRESOLVED")
    expect(finding!.severity).toBe("high")
    expect(finding!.worksiteId).toBe("ws-1")
    expect(finding!.entityType).toBe("dispatch_guide")
    expect(finding!.href).toBe("/bodega/guias/gdi-1")
    expect(finding!.snapshot.shortfall).toBe(2)
    expect(JSON.stringify(finding!.snapshot)).toContain("Faltaron dos unidades")
  })

  it("una guía es un caso, no una línea: se regulariza entera", () => {
    const findings = detectDispatchGuideShrinkage({ lines: [
      line({ itemId: "gi-1", quantity: 5, quantityReceived: 3 }),
      line({ itemId: "gi-2", quantity: 10, quantityReceived: 6, productName: "Guante" }),
    ]})
    expect(findings).toHaveLength(1)
    expect(findings[0]!.snapshot.shortfall).toBe(6)
  })

  it("no acusa a la guía cotejada completa", () => {
    expect(detectDispatchGuideShrinkage({ lines: [line({ quantityReceived: 5 })] })).toHaveLength(0)
  })

  it("no acusa a la que todavía no se coteja: falta una visita, no una corrección", () => {
    expect(detectDispatchGuideShrinkage({ lines: [
      line({ guideStatus: "dispatched", quantityReceived: 0 }),
    ]})).toHaveLength(0)
  })

  it("ignora la guía anulada y la que ya se recibió", () => {
    expect(detectDispatchGuideShrinkage({ lines: [
      line({ guideStatus: "cancelled", quantityReceived: 0 }),
      line({ guideStatus: "received", quantityReceived: 5, itemId: "gi-2" }),
    ]})).toHaveLength(0)
  })

  it("el caso es el mismo mientras la diferencia lo sea: no se duplica en cada escaneo", () => {
    const first = detectDispatchGuideShrinkage({ lines: [line()] })[0]!
    const second = detectDispatchGuideShrinkage({ lines: [line()] })[0]!
    expect(second.caseKey).toBe(first.caseKey)
    expect(second.fingerprint).toBe(first.fingerprint)
  })

  it("pero cambia de huella cuando la diferencia cambia, para que se vuelva a mirar", () => {
    const antes = detectDispatchGuideShrinkage({ lines: [line({ quantityReceived: 3 })] })[0]!
    const despues = detectDispatchGuideShrinkage({ lines: [line({ quantityReceived: 4 })] })[0]!
    expect(despues.caseKey).toBe(antes.caseKey)
    expect(despues.fingerprint).not.toBe(antes.fingerprint)
  })
})
