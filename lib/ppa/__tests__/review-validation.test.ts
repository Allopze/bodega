import { describe, it, expect } from "vitest"
import { ppaReviewSchema } from "@/lib/validation/ppa"

describe("ppaReviewSchema", () => {
  it("rechaza autorizar sin acción correctiva", () => {
    const res = ppaReviewSchema.safeParse({
      ppaId: "abc", fuiAlLugar: true, decision: "autorizado", accionCorrectiva: "",
    })
    expect(res.success).toBe(false)
  })

  it("permite autorizar con una acción asignada", () => {
    const res = ppaReviewSchema.safeParse({
      ppaId: "abc", fuiAlLugar: true, decision: "autorizado",
      accionCorrectiva: "Se bloqueó el equipo y se reinstruyó al trabajador.",
      responsibleRole: "prevencionista_faena",
      responsible: "María Pérez",
      dueDate: "2026-07-20",
      priority: "alta",
    })
    expect(res.success).toBe(true)
  })

  it("rechaza autorizar sin responsable ni plazo", () => {
    const res = ppaReviewSchema.safeParse({
      ppaId: "abc", fuiAlLugar: true, decision: "autorizado",
      accionCorrectiva: "Se bloqueó el equipo y se reinstruyó al trabajador.",
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.flatten().fieldErrors).toMatchObject({
        responsibleRole: expect.any(Array),
        responsible: expect.any(Array),
        dueDate: expect.any(Array),
      })
    }
  })

  it("permite rechazar sin acción correctiva", () => {
    const res = ppaReviewSchema.safeParse({
      ppaId: "abc", fuiAlLugar: false, decision: "rechazado",
    })
    expect(res.success).toBe(true)
  })
})
