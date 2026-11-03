/**
 * Pendientes por regla (CHART-023a): la frase que contesta la lista y el parámetro
 * `?regla=` con el que cada fila abre la bandeja filtrada.
 */
import { describe, expect, it } from "vitest"
import { caseRuleLabel, parseCaseRuleParam, summarizeCaseRules } from "./case-rules"

describe("caseRuleLabel", () => {
  it("usa el nombre de la regla y, sin ficha, su código", () => {
    expect(caseRuleLabel({ ruleCode: "sello_repetido", ruleName: "Sello repetido", count: 3 })).toBe("Sello repetido")
    expect(caseRuleLabel({ ruleCode: "regla_sin_ficha", ruleName: null, count: 1 })).toBe("regla_sin_ficha")
  })
})

describe("summarizeCaseRules", () => {
  it("nombra la regla con más casos y su parte del total", () => {
    expect(summarizeCaseRules([
      { ruleCode: "sello_repetido", ruleName: "Sello repetido", count: 6 },
      { ruleCode: "kilometraje_regresivo", ruleName: "Kilometraje inferior al anterior", count: 2 },
    ])).toBe("«Sello repetido» reúne 6 de los 8 casos pendientes.")
  })

  it("no depende del orden en que llegan las reglas", () => {
    expect(summarizeCaseRules([
      { ruleCode: "b", ruleName: "B", count: 1 },
      { ruleCode: "a", ruleName: "A", count: 4 },
    ])).toBe("«A» reúne 4 de los 5 casos pendientes.")
  })

  it("con una sola regla, todo es de ella", () => {
    expect(summarizeCaseRules([{ ruleCode: "sello_repetido", ruleName: "Sello repetido", count: 1 }]))
      .toBe("El único caso pendiente es de «Sello repetido».")
    expect(summarizeCaseRules([{ ruleCode: "sello_repetido", ruleName: "Sello repetido", count: 4 }]))
      .toBe("Los 4 casos pendientes son todos de «Sello repetido».")
  })

  it("sin casos pendientes no hay frase", () => {
    expect(summarizeCaseRules([])).toBeNull()
  })
})

describe("parseCaseRuleParam", () => {
  it("acepta un código de regla y descarta lo que no lo parece", () => {
    expect(parseCaseRuleParam("sello_repetido")).toBe("sello_repetido")
    expect(parseCaseRuleParam("  evidencia_faltante ")).toBe("evidencia_faltante")
    expect(parseCaseRuleParam(undefined)).toBeUndefined()
    expect(parseCaseRuleParam("")).toBeUndefined()
    expect(parseCaseRuleParam("Sello repetido")).toBeUndefined()
    expect(parseCaseRuleParam("x'; drop table fuel_anomaly_cases;--")).toBeUndefined()
    expect(parseCaseRuleParam("a".repeat(81))).toBeUndefined()
  })
})
