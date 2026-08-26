import { describe, expect, it } from "vitest"
import {
  DEFAULT_RISK_METHODOLOGY,
  RISK_CLASSIFICATIONS,
  RISK_CLASSIFICATION_TO_LEVEL,
  RISK_LEVEL_TO_CLASSIFICATION,
  classifyRisk,
  computeRiskMagnitude,
  evaluateRisk,
  parseRiskClassification,
  parseScaleValue,
  resolveMethodology,
  riskEntryIdentityKey,
} from "./risk-engine"

describe("motor de evaluación de riesgo P×C", () => {
  // Ficha §95: las 9 combinaciones exactas de la fórmula del Excel real
  // (P14=N14*O14, clasificación por IF anidado).
  it.each([
    [1, 1, 1, "tolerable"],
    [1, 2, 2, "tolerable"],
    [1, 4, 4, "moderado"],
    [2, 1, 2, "tolerable"],
    [2, 2, 4, "moderado"],
    [2, 4, 8, "importante"],
    [4, 1, 4, "moderado"],
    [4, 2, 8, "importante"],
    [4, 4, 16, "intolerable"],
  ] as const)("P=%s × C=%s → MR=%s (%s)", (probability, consequence, magnitude, classification) => {
    expect(computeRiskMagnitude(probability, consequence)).toBe(magnitude)
    expect(classifyRisk(magnitude)).toBe(classification)
    expect(evaluateRisk({ probability, consequence })).toMatchObject({ riskMagnitude: magnitude, riskClassification: classification })
  })

  it("rechaza probabilidad o consecuencia fuera de la escala", () => {
    expect(() => evaluateRisk({ probability: 3 as never, consequence: 2 })).toThrow(/probabilidad inválida/i)
    expect(() => evaluateRisk({ probability: 2, consequence: 3 as never })).toThrow(/consecuencia inválida/i)
  })

  it("la magnitud fuera de banda revienta en vez de adivinar una clasificación", () => {
    expect(() => classifyRisk(32)).toThrow(/fuera de las bandas/i)
  })

  it("la biyección clasificación↔nivel es exacta en ambos sentidos, sin baldes perdidos", () => {
    for (const classification of RISK_CLASSIFICATIONS) {
      const level = RISK_CLASSIFICATION_TO_LEVEL[classification]
      expect(RISK_LEVEL_TO_CLASSIFICATION[level]).toBe(classification)
    }
    // Los 4 niveles low/medium/high/critical deben estar cubiertos — ninguno inalcanzable.
    expect(new Set(Object.values(RISK_CLASSIFICATION_TO_LEVEL)).size).toBe(4)
  })

  it("evaluateRisk devuelve residualLevel/residualScore de compatibilidad", () => {
    const result = evaluateRisk({ probability: 4, consequence: 4 })
    expect(result.residualLevel).toBe("critical")
    expect(result.residualScore).toBe(16)
  })

  describe("parseScaleValue tolera texto humano libre (importación Excel)", () => {
    const scale = DEFAULT_RISK_METHODOLOGY.probability
    it.each([
      ["BAJA", 1],
      [" alta ", 4],
      ["Media", 2],
      [4, 4],
      ["4", 4],
      ["", null],
      [null, null],
      ["MEDIA-ALTA", null],
      [3, null],
    ] as const)("%p → %p", (input, expected) => {
      expect(parseScaleValue(input, scale)).toBe(expected)
    })
  })

  it("parseRiskClassification normaliza y rechaza lo desconocido", () => {
    expect(parseRiskClassification("TOLERABLE")).toBe("tolerable")
    expect(parseRiskClassification(" Intolerable ")).toBe("intolerable")
    expect(parseRiskClassification("REVISAR")).toBeNull()
    expect(parseRiskClassification(undefined)).toBeNull()
  })

  describe("resolveMethodology cae al default ante configuración vacía o desconocida", () => {
    it.each([[null], [undefined], [{}], [{ engineVersion: "x" }], ["texto"], [42]])("%p", (config) => {
      expect(resolveMethodology(config)).toEqual(DEFAULT_RISK_METHODOLOGY)
    })

    it("respeta una configuración completa distinta al default", () => {
      const custom = { ...DEFAULT_RISK_METHODOLOGY, engineVersion: "custom-v1", reviewIntervalDays: 365 }
      expect(resolveMethodology(custom)).toEqual(custom)
    })
  })

  it("riskEntryIdentityKey compone la tupla estable de identidad", () => {
    const entry = { processId: "p1", taskId: "t1", positionId: "pos1", hazardCode: "H1" }
    expect(riskEntryIdentityKey(entry)).toBe("p1|t1|pos1|H1")
    expect(riskEntryIdentityKey(entry)).toBe(riskEntryIdentityKey({ ...entry }))
    expect(riskEntryIdentityKey({ ...entry, hazardCode: "H2" })).not.toBe(riskEntryIdentityKey(entry))
  })
})
