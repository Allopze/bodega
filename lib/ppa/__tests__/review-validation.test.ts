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

  it("permite rechazar sin acción correctiva: no hay corrección que planificar", () => {
    const res = ppaReviewSchema.safeParse({
      ppaId: "abc", fuiAlLugar: false, decision: "rechazado",
      reviewNota: "El trabajo se anuló por decisión del cliente",
    })
    expect(res.success).toBe(true)
  })

  /**
   * PPAI-002 (auditoría 2026-09-14), patrón P6: la rama de rechazo devolvía sin
   * validar nada. Es la decisión más terminal del flujo —el trabajo no se hace
   * y el caso muere sin acción correctiva— y era la única sin justificación
   * obligatoria, en una plataforma que pide motivo para anular una guía, una
   * entrega o un pago.
   */
  it("pero no permite rechazar sin decir por qué", () => {
    const sinNota = ppaReviewSchema.safeParse({
      ppaId: "abc", fuiAlLugar: false, decision: "rechazado",
    })
    expect(sinNota.success).toBe(false)

    const casiNada = ppaReviewSchema.safeParse({
      ppaId: "abc", fuiAlLugar: false, decision: "rechazado", reviewNota: "no va",
    })
    expect(casiNada.success).toBe(false)
    if (!casiNada.success) {
      expect(casiNada.error.issues[0]?.path).toEqual(["reviewNota"])
    }
  })
})
