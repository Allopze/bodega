import { describe, expect, it } from "vitest"
import {
  sstActionPlanItemSchema,
  sstCloseEvaluationSchema,
  sstEvaluationCreateSchema,
  sstResponseSchema,
} from "@/lib/validation/sst"

const validEvaluation = {
  tipo: "nuevo",
  definicionCode: "trabajador_nuevo",
  workerId: "worker-1",
  worksiteId: "ws-1",
  fechaEvaluacion: "2026-06-30",
  cargos: ["conductor_ampliroll"],
}

describe("sstEvaluationCreateSchema", () => {
  it("accepts a valid payload", () => {
    const result = sstEvaluationCreateSchema.safeParse(validEvaluation)

    expect(result.success).toBe(true)
  })

  it("rejects empty cargos", () => {
    const result = sstEvaluationCreateSchema.safeParse({
      ...validEvaluation,
      cargos: [],
    })

    expect(result.success).toBe(false)
  })
})

describe("sstResponseSchema", () => {
  it("accepts a valid status", () => {
    const result = sstResponseSchema.safeParse({
      evaluationId: "eval-1",
      seccionId: "sec-1",
      itemId: "item-1",
      estado: "cumple",
    })

    expect(result.success).toBe(true)
  })

  it("rejects an invalid status", () => {
    const result = sstResponseSchema.safeParse({
      evaluationId: "eval-1",
      seccionId: "sec-1",
      itemId: "item-1",
      estado: "pendiente",
    })

    expect(result.success).toBe(false)
  })
})

describe("sstActionPlanItemSchema", () => {
  it("accepts a complete payload", () => {
    const result = sstActionPlanItemSchema.safeParse({
      evaluationId: "eval-1",
      n: 1,
      hallazgo: "Falta documentacion",
      accion: "Regularizar carpeta",
      responsable: "Prevencion",
      plazo: "2026-07-15",
      estado: "pendiente",
    })

    expect(result.success).toBe(true)
  })
})

describe("sstCloseEvaluationSchema", () => {
  it("accepts a valid close payload", () => {
    const result = sstCloseEvaluationSchema.safeParse({
      evaluationId: "eval-1",
      restricciones: "",
      observacionesGenerales: "Cierre revisado",
      hasCriticalDeviation: false,
      hasReincidence: false,
    })

    expect(result.success).toBe(true)
  })
})
