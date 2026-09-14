/**
 * Patrón P9 (auditoría 2026-09-14): la segregación existía donde se diseñó y
 * faltaba en los dos puntos donde se mueve dinero, `FAC-004` y `COB-002`.
 */
import { describe, expect, it } from "vitest"
import { requireDifferentActor } from "./segregation"

describe("requireDifferentActor", () => {
  it("otra persona puede", () => {
    expect(requireDifferentActor({ actedByUserId: "ana", actorUserId: "beto" }, "Revertir un pago"))
      .toEqual({ ok: true })
  })

  it("la misma persona no puede, y el mensaje dice qué hacer", () => {
    const decision = requireDifferentActor(
      { actedByUserId: "ana", actorUserId: "ana" }, "Revertir un pago",
    )
    expect(decision.ok).toBe(false)
    expect(decision.message).toContain("Revertir un pago")
    expect(decision.message).toContain("persona distinta")
    expect(decision.message).toContain("Pídeselo a otra persona")
  })

  it("un acto del sistema no tiene a quién separar", () => {
    // Una sugerencia automática de conciliación no la registró nadie: exigir
    // «alguien distinto» ahí sería un estorbo sin control a cambio.
    expect(requireDifferentActor({ actedByUserId: null, actorUserId: "ana" }, "x").ok).toBe(true)
    expect(requireDifferentActor({ actedByUserId: undefined, actorUserId: "ana" }, "x").ok).toBe(true)
  })
})
