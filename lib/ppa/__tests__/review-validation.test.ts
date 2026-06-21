import { describe, it, expect } from "vitest"
import { ppaReviewSchema } from "@/lib/validation/ppa"

describe("ppaReviewSchema", () => {
  it("rechaza autorizar sin acción correctiva", () => {
    const res = ppaReviewSchema.safeParse({
      ppaId: "abc", fuiAlLugar: true, decision: "autorizado", accionCorrectiva: "",
    })
    expect(res.success).toBe(false)
  })

  it("permite autorizar con acción correctiva", () => {
    const res = ppaReviewSchema.safeParse({
      ppaId: "abc", fuiAlLugar: true, decision: "autorizado",
      accionCorrectiva: "Se bloqueó el equipo y se reinstruyó al trabajador.",
    })
    expect(res.success).toBe(true)
  })

  it("permite rechazar sin acción correctiva", () => {
    const res = ppaReviewSchema.safeParse({
      ppaId: "abc", fuiAlLugar: false, decision: "rechazado",
    })
    expect(res.success).toBe(true)
  })
})
