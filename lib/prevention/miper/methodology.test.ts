import { describe, expect, it } from "vitest"
import {
  CLASSIFICATION_CRITERIA, CLASSIFICATION_LABEL, CONSEQUENCE_LEVELS, PROBABILITY_LEVELS,
  RE04_METHODOLOGY, RISK_CLASSIFICATIONS, classify, criticalityOf, isScaleValue, magnitudeOf,
} from "./methodology"
import { effectiveRiskLevel, normalizeRiskLevel } from "@/lib/prevention/risk-levels"

describe("metodología RE-04", () => {
  it("MR es P × C y la clasificación sigue las bandas del RE-04", () => {
    const table: Array<[number, number, number, string]> = [
      [1, 1, 1, "tolerable"], [1, 2, 2, "tolerable"], [2, 1, 2, "tolerable"],
      [2, 2, 4, "moderate"], [1, 4, 4, "moderate"], [4, 1, 4, "moderate"],
      [2, 4, 8, "important"], [4, 2, 8, "important"],
      [4, 4, 16, "intolerable"],
    ]
    for (const [p, c, mr, cls] of table) {
      expect(magnitudeOf(p, c)).toBe(mr)
      expect(classify(p, c)).toBe(cls)
    }
  })

  it("sin P o C, o con un valor fuera de {1,2,4}, no hay MR ni clasificación", () => {
    expect(classify(null, 2)).toBeNull()
    expect(classify(2, undefined)).toBeNull()
    expect(classify(3, 2)).toBeNull()
    expect(magnitudeOf(2, 0)).toBeNull()
    expect(isScaleValue(4)).toBe(true)
    expect(isScaleValue(3)).toBe(false)
  })

  it("cada nivel y cada banda tiene rótulo y texto del criterio", () => {
    expect(PROBABILITY_LEVELS.map((l) => l.value)).toEqual([1, 2, 4])
    expect(CONSEQUENCE_LEVELS.map((l) => l.value)).toEqual([1, 2, 4])
    for (const level of [...PROBABILITY_LEVELS, ...CONSEQUENCE_LEVELS]) expect(level.description.length).toBeGreaterThan(20)
    for (const cls of RISK_CLASSIFICATIONS) {
      expect(CLASSIFICATION_LABEL[cls]).toMatch(/^[A-ZÁÉÍÓÚ]/)
      expect(CLASSIFICATION_CRITERIA[cls].length).toBeGreaterThan(40)
    }
    expect(CLASSIFICATION_CRITERIA.intolerable).toMatch(/se debe prohibir el trabajo/)
  })

  it("la metodología persistible congela escalas y bandas", () => {
    expect(RE04_METHODOLOGY.code).toBe("RE-04-CHOME")
    expect(RE04_METHODOLOGY.configuration.probability).toHaveLength(3)
    expect(RE04_METHODOLOGY.configuration.bands.map((b) => b.classification)).toEqual([...RISK_CLASSIFICATIONS])
  })

  it("criticidad para CAPA y mapa: Tolerable es la más baja", () => {
    expect(criticalityOf("tolerable")).toBe("low")
    expect(criticalityOf("moderate")).toBe("medium")
    expect(criticalityOf("important")).toBe("high")
    expect(criticalityOf("intolerable")).toBe("critical")
  })

  it("nivel efectivo: manda la clasificación y cae a residual sólo en filas legacy", () => {
    expect(effectiveRiskLevel({ classification: "intolerable", residualLevel: "low" })).toBe("critical")
    expect(effectiveRiskLevel({ classification: null, residualLevel: "high" })).toBe("high")
    expect(effectiveRiskLevel({ classification: null, residualLevel: null })).toBeNull()
    // El alias antiguo "tolerable → medium" contradecía el RE-04.
    expect(normalizeRiskLevel("tolerable")).toBe("low")
  })
})
