import { describe, expect, it } from "vitest"
import { assessChangeReadiness, CHANGE_DIMENSIONS } from "@/lib/prevention/change"

function allEvaluated() {
  return CHANGE_DIMENSIONS.map((dimension) => ({ dimension, evaluated: true }))
}

describe("disponibilidad de la gestión del cambio", () => {
  it("un cambio con las 6 dimensiones evaluadas y fecha de revisión está listo", () => {
    const result = assessChangeReadiness({ assessments: allEvaluated(), plannedReviewDate: "2026-12-01" })
    expect(result).toEqual({ ready: true, blockers: [] })
  })

  it("rechaza un cambio sin ninguna dimensión evaluada", () => {
    const result = assessChangeReadiness({ assessments: [], plannedReviewDate: "2026-12-01" })
    expect(result.ready).toBe(false)
    expect(result.blockers[0]).toContain("Faltan por evaluar")
  })

  it("rechaza un cambio con una sola dimensión pendiente", () => {
    const assessments = allEvaluated().map((row) => row.dimension === "emergency" ? { ...row, evaluated: false } : row)
    const result = assessChangeReadiness({ assessments, plannedReviewDate: "2026-12-01" })
    expect(result.ready).toBe(false)
    expect(result.blockers[0]).toContain("Plan de emergencia")
  })

  it("rechaza un cambio sin fecha de revisión aunque todo esté evaluado", () => {
    const result = assessChangeReadiness({ assessments: allEvaluated(), plannedReviewDate: null })
    expect(result.ready).toBe(false)
    expect(result.blockers.some((b) => b.includes("revisión"))).toBe(true)
  })

  it("acumula ambos bloqueadores cuando faltan dimensiones y fecha", () => {
    const result = assessChangeReadiness({ assessments: [], plannedReviewDate: null })
    expect(result.blockers).toHaveLength(2)
  })

  it("una dimensión no evaluada en la lista cuenta igual que ausente", () => {
    const assessments = [{ dimension: "risk", evaluated: false }]
    const result = assessChangeReadiness({ assessments, plannedReviewDate: "2026-12-01" })
    expect(result.ready).toBe(false)
  })
})
