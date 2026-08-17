import { describe, expect, it } from "vitest"
import { assessChangeReadiness, CHANGE_DIMENSIONS } from "@/lib/prevention/change"
import { approveSchema, evaluateSchema } from "@/lib/services/prevention-change"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

const BASE_EVALUATION = {
  changeRequestId: "pchg-1",
  dimension: "risk",
  notes: "El cambio no altera el riesgo eléctrico evaluado.",
} as const

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

/**
 * MOC-04: `prevention_change_assessment_impact_consistent` prohíbe "no impacta
 * pero requiere acción". Sin esta validación la combinación llegaba hasta el
 * INSERT y el evaluador recibía un error de base sin campo al que apuntar.
 */
describe("evaluación de una dimensión: impacto y acción", () => {
  it("rechaza requerir acción sobre una dimensión declarada sin impacto", () => {
    const result = evaluateSchema.safeParse({
      ...BASE_EVALUATION,
      impacted: false,
      actionRequired: true,
      actionDescription: "Actualizar el catálogo de permisos.",
      targetDate: "2026-11-01",
    })
    expect(result.success).toBe(false)
    expect(result.error!.issues.map((issue) => issue.path)).toContainEqual(["impacted"])
    expect(result.error!.issues.find((issue) => issue.path[0] === "impacted")?.message).toContain("impactada")
  })

  it("acepta la misma acción cuando la dimensión sí se declara impactada", () => {
    const result = evaluateSchema.safeParse({
      ...BASE_EVALUATION,
      impacted: true,
      actionRequired: true,
      actionDescription: "Actualizar el catálogo de permisos.",
      targetDate: "2026-11-01",
    })
    expect(result.success).toBe(true)
  })

  it("acepta una dimensión sin impacto que tampoco requiere acción", () => {
    const result = evaluateSchema.safeParse({ ...BASE_EVALUATION, impacted: false, actionRequired: false })
    expect(result.success).toBe(true)
  })
})

/**
 * MOC-05: la fecha de revisión posterior se exigía para aprobar, pero no se
 * validaba como posterior ni tenía tope. "Ayer" pasaba, y "2199-01-01" también
 * — que es la forma cómoda de cumplir el requisito sin comprometerse a nada.
 */
describe("fecha de revisión posterior de un cambio aprobado", () => {
  const BASE_APPROVAL = { changeRequestId: "pchg-1", expectedVersion: 3 } as const
  const hoy = todayInChile()

  it("acepta una fecha posterior a la aprobación", () => {
    const result = approveSchema.safeParse({ ...BASE_APPROVAL, plannedReviewDate: addDaysToPlainDate(hoy, 90) })
    expect(result.success).toBe(true)
  })

  it("rechaza la fecha de hoy: 'posterior' no incluye el mismo día", () => {
    const result = approveSchema.safeParse({ ...BASE_APPROVAL, plannedReviewDate: hoy })
    expect(result.success).toBe(false)
    expect(result.error!.issues.map((issue) => issue.path)).toContainEqual(["plannedReviewDate"])
    expect(result.error!.issues[0]?.message).toContain("después de la fecha de aprobación")
  })

  it("rechaza una fecha anterior a la aprobación", () => {
    const result = approveSchema.safeParse({ ...BASE_APPROVAL, plannedReviewDate: addDaysToPlainDate(hoy, -1) })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]?.message).toContain("después de la fecha de aprobación")
  })

  it("acepta el borde exacto del horizonte de 24 meses", () => {
    const result = approveSchema.safeParse({ ...BASE_APPROVAL, plannedReviewDate: addDaysToPlainDate(hoy, 730) })
    expect(result.success).toBe(true)
  })

  it("rechaza un día más allá del horizonte", () => {
    const result = approveSchema.safeParse({ ...BASE_APPROVAL, plannedReviewDate: addDaysToPlainDate(hoy, 731) })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]?.message).toContain("24 meses")
  })

  it("rechaza la fecha lejana con la que se esquivaba el control", () => {
    const result = approveSchema.safeParse({ ...BASE_APPROVAL, plannedReviewDate: "2199-01-01" })
    expect(result.success).toBe(false)
  })
})
