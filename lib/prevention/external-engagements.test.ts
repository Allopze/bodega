import { describe, expect, it } from "vitest"
import { assessArt20Reciprocity, engagementMeasureKey } from "./external-engagements"

describe("assessArt20Reciprocity — simetría del DS 44 art. 20", () => {
  it("marca incumplimiento cuando sólo se recibió información", () => {
    const result = assessArt20Reciprocity([
      { kind: "coordinacion", direction: "received", infoTypes: ["riesgos", "plan_emergencia"] },
    ])

    expect(result.received).toEqual(["riesgos", "plan_emergencia"])
    expect(result.delivered).toEqual([])
    expect(result.missingDelivery).toEqual(["riesgos", "plan_emergencia"])
    expect(result.compliant).toBe(false)
  })

  it("cumple cuando cada tipo recibido tiene su contraparte entregada", () => {
    const result = assessArt20Reciprocity([
      { kind: "coordinacion", direction: "received", infoTypes: ["riesgos", "medidas"] },
      { kind: "coordinacion", direction: "delivered", infoTypes: ["riesgos"] },
      { kind: "coordinacion", direction: "delivered", infoTypes: ["medidas"] },
    ])

    expect(result.missingDelivery).toEqual([])
    expect(result.compliant).toBe(true)
  })

  it("detecta la entrega parcial, que es el caso real", () => {
    const result = assessArt20Reciprocity([
      { kind: "coordinacion", direction: "received", infoTypes: ["riesgos", "medidas", "plan_emergencia"] },
      { kind: "coordinacion", direction: "delivered", infoTypes: ["riesgos"] },
    ])

    expect(result.missingDelivery).toEqual(["medidas", "plan_emergencia"])
    expect(result.compliant).toBe(false)
  })

  it("ignora fiscalizaciones y visitas de la mutualidad: no exigen reciprocidad", () => {
    const result = assessArt20Reciprocity([
      { kind: "fiscalizacion", direction: "received", infoTypes: ["riesgos"] },
      { kind: "organismo_administrador", direction: "received", infoTypes: ["medidas"] },
    ])

    expect(result.received).toEqual([])
    expect(result.compliant).toBe(true)
  })

  it("no declara incumplimiento sin registros: la faena puede no compartir centro de trabajo", () => {
    expect(assessArt20Reciprocity([]).compliant).toBe(true)
  })

  it("descarta tipos de información desconocidos", () => {
    const result = assessArt20Reciprocity([
      { kind: "coordinacion", direction: "received", infoTypes: ["riesgos", "inventado"] },
      { kind: "coordinacion", direction: "delivered", infoTypes: ["riesgos"] },
    ])

    expect(result.received).toEqual(["riesgos"])
    expect(result.compliant).toBe(true)
  })
})

describe("engagementMeasureKey — idempotencia de las medidas prescritas", () => {
  it("es estable para la misma visita y número", () => {
    expect(engagementMeasureKey("eng-1", 2)).toBe("eng-1:2")
    expect(engagementMeasureKey("eng-1", 2)).toBe(engagementMeasureKey("eng-1", 2))
  })

  it("distingue medidas de visitas distintas", () => {
    expect(engagementMeasureKey("eng-1", 1)).not.toBe(engagementMeasureKey("eng-2", 1))
  })
})
