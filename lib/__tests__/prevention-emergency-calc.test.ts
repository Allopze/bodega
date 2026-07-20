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
  it("un simulacro con participantes presentes y resultado está listo", () => {
    const result = assessDrillCompletion({
      participants: [{ present: true }, { present: false }],
      evacuationSeconds: 180,
      outcome: "satisfactory",
    })
    expect(result).toEqual({ ready: true, blockers: [] })
  })

  it("rechaza un simulacro sin nadie presente", () => {
    const result = assessDrillCompletion({
      participants: [{ present: false }],
      evacuationSeconds: null,
      outcome: "satisfactory",
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.some((b) => b.includes("participante"))).toBe(true)
  })

  it("rechaza un simulacro sin resultado declarado", () => {
    const result = assessDrillCompletion({
      participants: [{ present: true }],
      evacuationSeconds: null,
      outcome: null,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.some((b) => b.includes("resultado"))).toBe(true)
  })

  it("una lista de participantes vacía nunca queda lista", () => {
    expect(assessDrillCompletion({ participants: [], evacuationSeconds: null, outcome: "satisfactory" }).ready).toBe(false)
  })
})
