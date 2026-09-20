import { describe, expect, it } from "vitest"
import { assessDrillCompletion, assessPlanReadiness } from "@/lib/prevention/emergency"

describe("disponibilidad del plan de emergencia", () => {
  it("un plan con escenario y rol está listo para aprobar", () => {
    const result = assessPlanReadiness({ scenarios: [{ id: "s1" }], roles: [{ id: "r1" }] })
    expect(result).toEqual({ ready: true, blockers: [] })
  })

  it("rechaza un plan sin escenarios", () => {
    const result = assessPlanReadiness({ scenarios: [], roles: [{ id: "r1" }] })
    expect(result.ready).toBe(false)
    expect(result.blockers).toHaveLength(1)
  })

  it("rechaza un plan sin organigrama de emergencia", () => {
    const result = assessPlanReadiness({ scenarios: [{ id: "s1" }], roles: [] })
    expect(result.ready).toBe(false)
    expect(result.blockers).toHaveLength(1)
  })

  it("acumula ambos bloqueadores cuando faltan los dos", () => {
    expect(assessPlanReadiness({ scenarios: [], roles: [] }).blockers).toHaveLength(2)
  })
})

describe("cierre de un simulacro", () => {
  /* El gate era «al menos un participante presente». Esa lista se escribía y
   * ninguna consulta la leía, así que lo único que respaldaba el hecho era un
   * dato muerto. Desde el 2026-09-19 lo respalda el acta. */
  it("un simulacro con evidencia y resultado está listo", () => {
    const result = assessDrillCompletion({
      activeEvidenceCount: 1,
      evacuationSeconds: 180,
      outcome: "satisfactory",
    })
    expect(result).toEqual({ ready: true, blockers: [] })
  })

  it("rechaza un simulacro sin ninguna evidencia", () => {
    const result = assessDrillCompletion({
      activeEvidenceCount: 0,
      evacuationSeconds: null,
      outcome: "satisfactory",
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.some((b) => b.includes("evidencia"))).toBe(true)
  })

  it("rechaza un simulacro sin resultado declarado", () => {
    const result = assessDrillCompletion({
      activeEvidenceCount: 1,
      evacuationSeconds: null,
      outcome: null,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.some((b) => b.includes("resultado"))).toBe(true)
  })

  it("sin evidencia y sin resultado devuelve los dos bloqueadores, no el primero", () => {
    const result = assessDrillCompletion({ activeEvidenceCount: 0, evacuationSeconds: null, outcome: null })
    expect(result.ready).toBe(false)
    expect(result.blockers).toHaveLength(2)
  })
})
